import { createHash, createHmac } from "node:crypto";
import { redisCommand } from "./redis";

export const WAITLIST_CONSENT_VERSION = "first-auction-v1-2026-08-24";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SOURCE_FIELDS = [
  "utmSource",
  "utmMedium",
  "utmCampaign",
  "utmContent",
  "utmTerm",
  "referrerHost",
] as const;

export type WaitlistSource = Record<(typeof SOURCE_FIELDS)[number], string | null>;

export type WaitlistSignupInput = {
  email: string;
  consent: true;
  source: WaitlistSource;
};

export type WaitlistRecord = WaitlistSignupInput & {
  schemaVersion: 1;
  subscriberId: string;
  consentVersion: typeof WAITLIST_CONSENT_VERSION;
  status: "active";
  createdAt: string;
};

function parseWaitlistRecord(raw: unknown): WaitlistRecord | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const candidate = JSON.parse(raw) as Partial<WaitlistRecord>;
    const email = normalizeWaitlistEmail(candidate.email);
    const id = email ? subscriberId(email) : null;
    const source = candidate.source && typeof candidate.source === "object"
      ? Object.fromEntries(SOURCE_FIELDS.map((field) => [field, cleanSourceValue(candidate.source?.[field])])) as WaitlistSource
      : null;
    if (
      candidate.schemaVersion !== 1 ||
      !email ||
      candidate.consent !== true ||
      candidate.subscriberId !== id ||
      candidate.consentVersion !== WAITLIST_CONSENT_VERSION ||
      candidate.status !== "active" ||
      !source ||
      Object.values(source).some((value) => value === undefined) ||
      typeof candidate.createdAt !== "string" ||
      !Number.isFinite(Date.parse(candidate.createdAt))
    ) {
      return null;
    }
    return {
      schemaVersion: 1,
      subscriberId: candidate.subscriberId,
      email,
      consent: true,
      source,
      consentVersion: WAITLIST_CONSENT_VERSION,
      status: "active",
      createdAt: candidate.createdAt,
    };
  } catch {
    return null;
  }
}

function environmentName() {
  return process.env.VERCEL_ENV ?? "local";
}

function prefix() {
  return `fiszy:${environmentName()}`;
}

function cleanSourceValue(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (
    normalized.length < 1 ||
    normalized.length > 160 ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    return undefined;
  }
  return normalized;
}

export function normalizeWaitlistEmail(value: unknown) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLocaleLowerCase("en-US");
  if (email.length < 3 || email.length > 254 || !EMAIL_PATTERN.test(email)) {
    return null;
  }
  return email;
}

export function normalizeWaitlistSignup(value: unknown): WaitlistSignupInput | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const email = normalizeWaitlistEmail(candidate.email);
  if (!email || candidate.consent !== true) return null;

  const rawSource = candidate.source;
  if (!rawSource || typeof rawSource !== "object") return null;
  const sourceCandidate = rawSource as Record<string, unknown>;
  const sourceEntries = SOURCE_FIELDS.map((field) => [
    field,
    cleanSourceValue(sourceCandidate[field]),
  ] as const);
  if (sourceEntries.some(([, fieldValue]) => fieldValue === undefined)) return null;

  return {
    email,
    consent: true,
    source: Object.fromEntries(sourceEntries) as WaitlistSource,
  };
}

function subscriberId(email: string) {
  return createHash("sha256").update(email).digest("hex");
}

function waitlistSubscriberKey(id: string) {
  return `${prefix()}:waitlist:v1:subscriber:${id}`;
}

function waitlistIndexKey() {
  return `${prefix()}:waitlist:v1:index`;
}

export async function saveWaitlistSignup(input: WaitlistSignupInput) {
  const id = subscriberId(input.email);
  const createdAt = new Date().toISOString();
  const record: WaitlistRecord = {
    schemaVersion: 1,
    subscriberId: id,
    ...input,
    consentVersion: WAITLIST_CONSENT_VERSION,
    status: "active",
    createdAt,
  };
  const result = await redisCommand<number>([
    "EVAL",
    `
if redis.call("EXISTS", KEYS[1]) == 1 then return 0 end
redis.call("SET", KEYS[1], ARGV[1])
redis.call("ZADD", KEYS[2], ARGV[2], ARGV[3])
return 1
`,
    2,
    waitlistSubscriberKey(id),
    waitlistIndexKey(),
    JSON.stringify(record),
    Date.parse(createdAt),
    id,
  ]);
  return { created: result === 1 };
}

export async function listRecentWaitlistSignups(limit = 500) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new Error("Invalid waitlist limit.");
  }
  const [members, count] = await Promise.all([
    redisCommand<string[]>(["ZREVRANGE", waitlistIndexKey(), 0, limit - 1]),
    redisCommand<number>(["ZCARD", waitlistIndexKey()]),
  ]);
  if (!members?.length) return { signups: [], total: count ?? 0 };
  const raw = await redisCommand<Array<string | null>>([
    "MGET",
    ...members.map(waitlistSubscriberKey),
  ]);
  const signups = (raw ?? []).flatMap((value, index) => {
    const record = parseWaitlistRecord(value);
    return record?.subscriberId === members[index] ? [record] : [];
  });
  return { signups, total: count ?? signups.length };
}

export async function consumeWaitlistRateLimit(clientAddress: string) {
  const salt =
    process.env.FISZY_RATE_LIMIT_SECRET?.trim() ||
    process.env.FISZY_ADMIN_SECRET?.trim() ||
    "fiszy-local-rate-limit-v1";
  const fingerprint = createHmac("sha256", salt)
    .update(`waitlist:${clientAddress}`)
    .digest("hex")
    .slice(0, 32);
  const key = `${prefix()}:rate:v1:waitlist:${fingerprint}`;
  const result = await redisCommand<Array<number>>([
    "EVAL",
    `
local value = redis.call("INCR", KEYS[1])
if value == 1 then redis.call("EXPIRE", KEYS[1], ARGV[1]) end
return {value, redis.call("TTL", KEYS[1])}
`,
    1,
    key,
    600,
  ]);
  const [attempts = 11, ttl = 600] = result ?? [];
  return { allowed: attempts <= 10, retryAfter: Math.max(1, ttl) };
}
