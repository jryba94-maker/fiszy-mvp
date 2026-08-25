import { createHash, randomUUID } from "node:crypto";
import { redisCommand } from "./redis";
import { listSortedSetPage } from "./sorted-set-pagination";

export const PRIVACY_CONSENT_VERSION = "portal-v1-2026-08-25";
export const PRIVACY_PURPOSES = ["marketing", "analytics"] as const;
export const PRIVACY_REQUEST_KINDS = ["access", "rectification", "erasure", "restriction", "objection"] as const;
export const PRIVACY_REQUEST_STATUSES = ["requested", "verified", "processing", "completed", "rejected"] as const;
export type PrivacyPurpose = (typeof PRIVACY_PURPOSES)[number];
export type PrivacyRequestKind = (typeof PRIVACY_REQUEST_KINDS)[number];
export type PrivacyRequestStatus = (typeof PRIVACY_REQUEST_STATUSES)[number];

export function isPrivacyRequestTransitionAllowed(
  previous: PrivacyRequestStatus,
  next: PrivacyRequestStatus,
) {
  return (
    (previous === "requested" && (next === "verified" || next === "rejected")) ||
    (previous === "verified" && (next === "processing" || next === "rejected")) ||
    (previous === "processing" && (next === "completed" || next === "rejected"))
  );
}

export type PrivacyConsentEvent = {
  schemaVersion: 1;
  eventId: string;
  accountId: string;
  purpose: PrivacyPurpose;
  granted: boolean;
  policyVersion: typeof PRIVACY_CONSENT_VERSION;
  occurredAt: string;
};

export type PrivacyRequest = {
  schemaVersion: 1;
  requestId: string;
  accountId: string;
  kind: PrivacyRequestKind;
  status: PrivacyRequestStatus;
  note: string | null;
  adminNote: string | null;
  dueAt: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9_-]{3,100}$/;
const REQUEST_ID_PATTERN = /^PRIV-[A-F0-9]{24}$/;
function prefix() { return `fiszy:${process.env.VERCEL_ENV ?? "local"}`; }
function account(value: string) { const id = value.trim(); if (!ACCOUNT_ID_PATTERN.test(id)) throw new Error("Invalid account id."); return id; }
function requestKey(id: string) { if (!REQUEST_ID_PATTERN.test(id)) throw new Error("Invalid privacy request id."); return `${prefix()}:privacy:request:${id}`; }
function requestIndex() { return `${prefix()}:index:v1:privacy-requests`; }
function accountRequestIndex(id: string) { return `${prefix()}:account:${encodeURIComponent(account(id))}:index:v1:privacy-requests`; }
function consentIndex(id: string) { return `${prefix()}:account:${encodeURIComponent(account(id))}:index:v1:privacy-consents`; }
function consentEventKey(id: string, eventId: string) { return `${prefix()}:account:${encodeURIComponent(account(id))}:privacy-consent:${eventId}`; }
function consentCurrentKey(id: string, purpose: PrivacyPurpose) { return `${prefix()}:account:${encodeURIComponent(account(id))}:privacy-consent-current:${purpose}`; }
function activeRequestKey(id: string, kind: PrivacyRequestKind) { return `${prefix()}:account:${encodeURIComponent(account(id))}:privacy-request-active:${kind}`; }
function accountPurpose(id: string, suffix: string) { return `privacy.${suffix}.${createHash("sha256").update(account(id)).digest("hex").slice(0, 16)}`; }
function optionalText(value: unknown, max: number) {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length <= max && !/[\u0000-\u001f\u007f]/.test(normalized) ? normalized : null;
}

function parseConsent(raw: unknown): PrivacyConsentEvent | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const value = JSON.parse(raw) as PrivacyConsentEvent;
    return value.schemaVersion === 1 && ACCOUNT_ID_PATTERN.test(value.accountId) && PRIVACY_PURPOSES.includes(value.purpose) && typeof value.granted === "boolean" && value.policyVersion === PRIVACY_CONSENT_VERSION && Number.isFinite(Date.parse(value.occurredAt)) ? value : null;
  } catch { return null; }
}

export async function recordPrivacyConsent(input: { accountId: string; purpose: PrivacyPurpose; granted: boolean }) {
  const accountId = account(input.accountId);
  if (!PRIVACY_PURPOSES.includes(input.purpose)) throw new Error("Invalid privacy purpose.");
  const occurredAt = new Date().toISOString();
  const event: PrivacyConsentEvent = { schemaVersion: 1, eventId: `CONS-${randomUUID().replaceAll("-", "").slice(0, 24).toUpperCase()}`, accountId, purpose: input.purpose, granted: input.granted, policyVersion: PRIVACY_CONSENT_VERSION, occurredAt };
  await redisCommand<number>(["EVAL", `
redis.call("SET", KEYS[1], ARGV[1])
redis.call("SET", KEYS[2], ARGV[1])
redis.call("ZADD", KEYS[3], ARGV[2], ARGV[3])
return 1`, 3, consentEventKey(accountId, event.eventId), consentCurrentKey(accountId, input.purpose), consentIndex(accountId), JSON.stringify(event), Date.parse(occurredAt), event.eventId]);
  return event;
}

export async function readPrivacyConsents(accountIdValue: string) {
  const accountId = account(accountIdValue);
  const raw = await redisCommand<Array<string | null>>(["MGET", ...PRIVACY_PURPOSES.map((purpose) => consentCurrentKey(accountId, purpose))]);
  return Object.fromEntries(PRIVACY_PURPOSES.map((purpose, index) => [purpose, parseConsent(raw?.[index])])) as Record<PrivacyPurpose, PrivacyConsentEvent | null>;
}

function parseRequest(raw: unknown): PrivacyRequest | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const value = JSON.parse(raw) as PrivacyRequest;
    return value.schemaVersion === 1 && REQUEST_ID_PATTERN.test(value.requestId) && ACCOUNT_ID_PATTERN.test(value.accountId) && PRIVACY_REQUEST_KINDS.includes(value.kind) && PRIVACY_REQUEST_STATUSES.includes(value.status) && Number.isInteger(value.revision) && value.revision > 0 && Number.isFinite(Date.parse(value.createdAt)) && Number.isFinite(Date.parse(value.updatedAt)) && Number.isFinite(Date.parse(value.dueAt)) ? value : null;
  } catch { return null; }
}

export async function readPrivacyRequest(requestId: string) {
  if (!REQUEST_ID_PATTERN.test(requestId)) return null;
  return parseRequest(await redisCommand<string>(["GET", requestKey(requestId)]));
}

export async function createPrivacyRequest(input: { accountId: string; kind: PrivacyRequestKind; note?: string | null }) {
  const accountId = account(input.accountId);
  const note = optionalText(input.note, 1000);
  if (!PRIVACY_REQUEST_KINDS.includes(input.kind) || note === null) throw new Error("Invalid privacy request.");
  const createdAt = new Date().toISOString();
  const record: PrivacyRequest = { schemaVersion: 1, requestId: `PRIV-${randomUUID().replaceAll("-", "").slice(0, 24).toUpperCase()}`, accountId, kind: input.kind, status: "requested", note: note || null, adminNote: null, dueAt: new Date(Date.parse(createdAt) + 30 * 24 * 60 * 60_000).toISOString(), revision: 1, createdAt, updatedAt: createdAt, completedAt: null };
  const stored = await redisCommand<Array<number | string>>(["EVAL", `
local active = redis.call("GET", KEYS[4])
if active then return {0, active} end
if redis.call("EXISTS", KEYS[1]) == 1 then return {-1, "collision"} end
redis.call("SET", KEYS[1], ARGV[1])
redis.call("ZADD", KEYS[2], ARGV[2], ARGV[3])
redis.call("ZADD", KEYS[3], ARGV[2], ARGV[3])
redis.call("SET", KEYS[4], ARGV[3])
return {1, ARGV[3]}`, 4, requestKey(record.requestId), requestIndex(), accountRequestIndex(accountId), activeRequestKey(accountId, input.kind), JSON.stringify(record), Date.parse(createdAt), record.requestId]);
  if (!Array.isArray(stored) || typeof stored[1] !== "string") throw new Error("Unable to create privacy request.");
  if (stored[0] === 0) {
    const existing = await readPrivacyRequest(stored[1]);
    if (existing?.accountId === accountId && existing.kind === input.kind && existing.status !== "completed" && existing.status !== "rejected") return existing;
    throw new Error("Stored active privacy request is invalid.");
  }
  if (stored[0] !== 1) throw new Error("Unable to create privacy request.");
  return record;
}

async function listRequests(input: { indexKey: string; purpose: string; cursor?: string | null; limit?: number; accountId?: string }) {
  const page = await listSortedSetPage({ indexKey: input.indexKey, purpose: input.purpose, cursor: input.cursor, limit: input.limit ?? 20 });
  if (!page) return null;
  const raw = page.members.length ? ((await redisCommand<Array<string | null>>(["MGET", ...page.members.map(requestKey)])) ?? []) : [];
  return { requests: raw.flatMap((item, index) => { const record = parseRequest(item); return record?.requestId === page.members[index] && (!input.accountId || record.accountId === input.accountId) ? [record] : []; }), nextCursor: page.nextCursor };
}

export function listAccountPrivacyRequests(input: { accountId: string; cursor?: string | null; limit?: number }) {
  const accountId = account(input.accountId);
  return listRequests({ indexKey: accountRequestIndex(accountId), purpose: accountPurpose(accountId, "account-requests"), cursor: input.cursor, limit: input.limit, accountId });
}
export function listPrivacyRequests(input: { cursor?: string | null; limit?: number }) {
  return listRequests({ indexKey: requestIndex(), purpose: "privacy.requests.all", cursor: input.cursor, limit: input.limit });
}

export async function updatePrivacyRequest(input: { requestId: string; expectedRevision: number; status: PrivacyRequestStatus; adminNote?: string | null }) {
  const current = await readPrivacyRequest(input.requestId);
  const adminNote = optionalText(input.adminNote, 2000);
  if (
    !current ||
    current.revision !== input.expectedRevision ||
    !PRIVACY_REQUEST_STATUSES.includes(input.status) ||
    !isPrivacyRequestTransitionAllowed(current.status, input.status) ||
    adminNote === null ||
    ((input.status === "completed" || input.status === "rejected") && !adminNote)
  ) return null;
  const updatedAt = new Date().toISOString();
  const next: PrivacyRequest = { ...current, status: input.status, adminNote: adminNote || null, revision: current.revision + 1, updatedAt, completedAt: input.status === "completed" ? updatedAt : null };
  const stored = await redisCommand<number>(["EVAL", `
local raw = redis.call("GET", KEYS[1])
if not raw then return 0 end
local ok, current = pcall(cjson.decode, raw)
if not ok or type(current) ~= "table" or current.revision ~= tonumber(ARGV[1]) then return 0 end
redis.call("SET", KEYS[1], ARGV[2])
if ARGV[3] == "completed" or ARGV[3] == "rejected" then
  local active = redis.call("GET", KEYS[2])
  if active == ARGV[4] then redis.call("DEL", KEYS[2]) end
end
return 1`, 2, requestKey(input.requestId), activeRequestKey(current.accountId, current.kind), current.revision, JSON.stringify(next), next.status, current.requestId]);
  return stored === 1 ? next : null;
}
