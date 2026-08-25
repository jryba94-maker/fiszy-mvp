import { createHash, randomUUID } from "node:crypto";
import { redisCommand } from "./redis";
import { listSortedSetPage } from "./sorted-set-pagination";

export const SERVICE_CASE_KINDS = ["support", "complaint", "return", "withdrawal"] as const;
export const SERVICE_CASE_STATUSES = [
  "submitted",
  "reviewing",
  "waiting_for_customer",
  "accepted",
  "rejected",
  "completed",
] as const;
export type ServiceCaseKind = (typeof SERVICE_CASE_KINDS)[number];
export type ServiceCaseStatus = (typeof SERVICE_CASE_STATUSES)[number];

export function isServiceCaseTransitionAllowed(
  previous: ServiceCaseStatus,
  next: ServiceCaseStatus,
) {
  if (previous === next) return true;
  if (previous === "submitted") return next === "reviewing" || next === "rejected";
  if (previous === "reviewing") return ["waiting_for_customer", "accepted", "rejected", "completed"].includes(next);
  if (previous === "waiting_for_customer") return ["reviewing", "accepted", "rejected"].includes(next);
  if (previous === "accepted") return next === "completed";
  return false;
}

export type ServiceCase = {
  schemaVersion: 1;
  caseId: string;
  accountId: string;
  kind: ServiceCaseKind;
  subject: string;
  description: string;
  orderId: string | null;
  contactEmail: string;
  expectation: string | null;
  status: ServiceCaseStatus;
  adminResponse: string | null;
  resolution: string | null;
  refundStatus: "not_applicable" | "pending" | "completed";
  responseDueAt: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

const CASE_ID_PATTERN = /^CASE-[A-F0-9]{24}$/;
const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9_-]{3,100}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function prefix() { return `fiszy:${process.env.VERCEL_ENV ?? "local"}`; }
function checkedAccountId(value: string) {
  const normalized = value.trim();
  if (!ACCOUNT_ID_PATTERN.test(normalized)) throw new Error("Invalid account id.");
  return normalized;
}
function caseKey(caseId: string) {
  if (!CASE_ID_PATTERN.test(caseId)) throw new Error("Invalid case id.");
  return `${prefix()}:service-case:${caseId}`;
}
function allIndexKey() { return `${prefix()}:index:v1:service-cases`; }
function statusIndexKey(status: ServiceCaseStatus) { return `${prefix()}:index:v1:service-cases:status:${status}`; }
function accountIndexKey(accountId: string) {
  return `${prefix()}:account:${encodeURIComponent(checkedAccountId(accountId))}:index:v1:service-cases`;
}
function accountPurpose(accountId: string) {
  return `service-cases.account.${createHash("sha256").update(accountId).digest("hex").slice(0, 16)}`;
}
function text(value: unknown, max: number, required = true) {
  if (value === null || value === undefined || value === "") return required ? null : "";
  if (typeof value !== "string") return null;
  const result = value.trim().replace(/\s+/g, " ");
  return result && result.length <= max && !/[\u0000-\u001f\u007f]/.test(result) ? result : null;
}

export function normalizeServiceCaseInput(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const subject = text(candidate.subject, 140);
  const description = text(candidate.description, 4000);
  const expectation = text(candidate.expectation, 1000, false);
  const orderId = text(candidate.orderId, 200, false);
  const contactEmail = typeof candidate.contactEmail === "string" ? candidate.contactEmail.trim().toLowerCase() : "";
  if (
    !SERVICE_CASE_KINDS.includes(candidate.kind as ServiceCaseKind) ||
    !subject || !description || expectation === null || orderId === null ||
    contactEmail.length > 254 || !EMAIL_PATTERN.test(contactEmail)
  ) return null;
  if ((candidate.kind === "return" || candidate.kind === "withdrawal") && !orderId) return null;
  return {
    kind: candidate.kind as ServiceCaseKind,
    subject,
    description,
    expectation: expectation || null,
    orderId: orderId || null,
    contactEmail,
  };
}

function parseCase(raw: unknown): ServiceCase | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<ServiceCase>;
    if (
      value.schemaVersion !== 1 || !CASE_ID_PATTERN.test(value.caseId ?? "") ||
      !ACCOUNT_ID_PATTERN.test(value.accountId ?? "") ||
      !SERVICE_CASE_KINDS.includes(value.kind as ServiceCaseKind) ||
      !SERVICE_CASE_STATUSES.includes(value.status as ServiceCaseStatus) ||
      !EMAIL_PATTERN.test(value.contactEmail ?? "") ||
      typeof value.subject !== "string" || typeof value.description !== "string" ||
      !Number.isInteger(value.revision) || Number(value.revision) < 1 ||
      !Number.isFinite(Date.parse(value.createdAt ?? "")) ||
      !Number.isFinite(Date.parse(value.updatedAt ?? "")) ||
      !Number.isFinite(Date.parse(value.responseDueAt ?? ""))
    ) return null;
    return value as ServiceCase;
  } catch { return null; }
}

export async function readServiceCase(caseId: string) {
  if (!CASE_ID_PATTERN.test(caseId)) return null;
  return parseCase(await redisCommand<string>(["GET", caseKey(caseId)]));
}

export async function createServiceCase(input: {
  accountId: string;
  kind: ServiceCaseKind;
  subject: string;
  description: string;
  orderId: string | null;
  contactEmail: string;
  expectation: string | null;
}) {
  const accountId = checkedAccountId(input.accountId);
  const createdAt = new Date().toISOString();
  const record: ServiceCase = {
    schemaVersion: 1,
    caseId: `CASE-${randomUUID().replaceAll("-", "").slice(0, 24).toUpperCase()}`,
    accountId,
    kind: input.kind,
    subject: input.subject,
    description: input.description,
    orderId: input.orderId,
    contactEmail: input.contactEmail,
    expectation: input.expectation,
    status: "submitted",
    adminResponse: null,
    resolution: null,
    refundStatus: "not_applicable",
    responseDueAt: new Date(Date.parse(createdAt) + 14 * 24 * 60 * 60_000).toISOString(),
    revision: 1,
    createdAt,
    updatedAt: createdAt,
  };
  const score = Date.parse(createdAt);
  const stored = await redisCommand<number>([
    "EVAL", `
if redis.call("EXISTS", KEYS[1]) == 1 then return 0 end
redis.call("SET", KEYS[1], ARGV[1])
redis.call("ZADD", KEYS[2], ARGV[2], ARGV[3])
redis.call("ZADD", KEYS[3], ARGV[2], ARGV[3])
redis.call("ZADD", KEYS[4], ARGV[2], ARGV[3])
return 1`, 4,
    caseKey(record.caseId), allIndexKey(), accountIndexKey(accountId), statusIndexKey(record.status),
    JSON.stringify(record), score, record.caseId,
  ]);
  if (stored !== 1) throw new Error("Unable to create service case.");
  return record;
}

async function listCases(input: { indexKey: string; purpose: string; cursor?: string | null; limit?: number; accountId?: string }) {
  const page = await listSortedSetPage({ indexKey: input.indexKey, purpose: input.purpose, cursor: input.cursor, limit: input.limit ?? 20 });
  if (!page) return null;
  const raw = page.members.length
    ? ((await redisCommand<Array<string | null>>(["MGET", ...page.members.map(caseKey)])) ?? [])
    : [];
  return {
    cases: raw.flatMap((item, index) => {
      const record = parseCase(item);
      return record?.caseId === page.members[index] && (!input.accountId || record.accountId === input.accountId) ? [record] : [];
    }),
    nextCursor: page.nextCursor,
  };
}

export function listAccountServiceCases(input: { accountId: string; cursor?: string | null; limit?: number }) {
  const accountId = checkedAccountId(input.accountId);
  return listCases({ indexKey: accountIndexKey(accountId), purpose: accountPurpose(accountId), cursor: input.cursor, limit: input.limit, accountId });
}

export function listServiceCases(input: { cursor?: string | null; limit?: number; status?: ServiceCaseStatus | null }) {
  const status = input.status ?? null;
  if (status && !SERVICE_CASE_STATUSES.includes(status)) return Promise.resolve(null);
  return listCases({
    indexKey: status ? statusIndexKey(status) : allIndexKey(),
    purpose: status ? `service-cases.status.${status}` : "service-cases.all",
    cursor: input.cursor,
    limit: input.limit,
  });
}

export async function updateServiceCase(input: {
  caseId: string;
  expectedRevision: number;
  status: ServiceCaseStatus;
  adminResponse: string | null;
  resolution: string | null;
  refundStatus: ServiceCase["refundStatus"];
}) {
  const current = await readServiceCase(input.caseId);
  const adminResponse = text(input.adminResponse, 3000, false);
  const resolution = text(input.resolution, 2000, false);
  const responseRequired = !["submitted", "reviewing"].includes(input.status);
  if (
    !current ||
    current.revision !== input.expectedRevision ||
    !SERVICE_CASE_STATUSES.includes(input.status) ||
    !isServiceCaseTransitionAllowed(current.status, input.status) ||
    adminResponse === null ||
    resolution === null ||
    (responseRequired && !adminResponse) ||
    (input.status === "completed" && !resolution) ||
    !["not_applicable", "pending", "completed"].includes(input.refundStatus)
  ) return null;
  const next: ServiceCase = { ...current, status: input.status, adminResponse: adminResponse || null, resolution: resolution || null, refundStatus: input.refundStatus, revision: current.revision + 1, updatedAt: new Date().toISOString() };
  const stored = await redisCommand<number>([
    "EVAL", `
local raw = redis.call("GET", KEYS[1])
if not raw then return 0 end
local ok, record = pcall(cjson.decode, raw)
if not ok or type(record) ~= "table" or record.revision ~= tonumber(ARGV[1]) then return 0 end
redis.call("SET", KEYS[1], ARGV[2])
if ARGV[3] ~= ARGV[4] then redis.call("ZREM", KEYS[2], ARGV[5]); redis.call("ZADD", KEYS[3], ARGV[6], ARGV[5]) end
return 1`, 3,
    caseKey(current.caseId), statusIndexKey(current.status), statusIndexKey(next.status),
    current.revision, JSON.stringify(next), current.status, next.status, current.caseId, Date.parse(next.createdAt),
  ]);
  return stored === 1 ? next : null;
}
