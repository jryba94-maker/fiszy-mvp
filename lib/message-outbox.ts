import { createHash, randomUUID } from "node:crypto";
import {
  sendTransactionalMessage,
  type TransactionalMessageTemplate,
} from "./transactional-email";
import { redisCommand } from "./redis";
import { listSortedSetPage } from "./sorted-set-pagination";

export type OutboxMessageState =
  | "queued"
  | "sending"
  | "retry"
  | "delivered"
  | "dead";

export type OutboxMessage = {
  schemaVersion: 1;
  messageId: string;
  dedupeKey: string;
  accountId: string | null;
  recipient: string;
  template: TransactionalMessageTemplate;
  title: string;
  text: string;
  actionLabel: string | null;
  actionUrl: string | null;
  scheduledAt: string | null;
  state: OutboxMessageState;
  attempts: number;
  nextAttemptAt: string;
  deliveredAt: string | null;
  lastErrorCode: string | null;
  createdAt: string;
  updatedAt: string;
};

const MESSAGE_ID_PATTERN = /^MSG-[A-F0-9]{24}$/;
const DEDUPE_PATTERN = /^[a-z0-9][a-z0-9_.:-]{7,200}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RETENTION_SECONDS = 90 * 24 * 60 * 60;

function environmentName() {
  return process.env.VERCEL_ENV ?? "local";
}

function prefix() {
  return `fiszy:${environmentName()}`;
}

function messageKey(messageId: string) {
  if (!MESSAGE_ID_PATTERN.test(messageId)) throw new Error("Invalid message id.");
  return `${prefix()}:outbox:message:${messageId}`;
}

function dueIndexKey() {
  return `${prefix()}:index:v1:outbox:due`;
}

function historyIndexKey() {
  return `${prefix()}:index:v1:outbox:history`;
}

function dedupeKey(value: string) {
  if (!DEDUPE_PATTERN.test(value)) throw new Error("Invalid message dedupe key.");
  const fingerprint = createHash("sha256").update(value).digest("hex");
  return `${prefix()}:outbox:dedupe:${fingerprint}`;
}

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength && !/[\u0000\u007f]/.test(normalized)
    ? normalized
    : null;
}

function parseOutboxMessage(raw: unknown): OutboxMessage | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<OutboxMessage>;
    if (
      value.schemaVersion !== 1 ||
      typeof value.messageId !== "string" ||
      !MESSAGE_ID_PATTERN.test(value.messageId) ||
      typeof value.dedupeKey !== "string" ||
      !DEDUPE_PATTERN.test(value.dedupeKey) ||
      (value.accountId !== null &&
        (typeof value.accountId !== "string" || value.accountId.length > 100)) ||
      typeof value.recipient !== "string" ||
      !EMAIL_PATTERN.test(value.recipient) ||
      !["waitlist_confirmation", "entry_confirmation", "auction_reminder", "auction_start", "auction_win", "discount_available", "order_confirmation", "order_update", "service_case_update"].includes(String(value.template)) ||
      !cleanText(value.title, 160) ||
      !cleanText(value.text, 4000) ||
      (value.actionLabel !== null && !cleanText(value.actionLabel, 80)) ||
      (value.actionUrl !== null && (
        typeof value.actionUrl !== "string" ||
        value.actionUrl.length > 500 ||
        !value.actionUrl.startsWith("https://")
      )) ||
      (value.scheduledAt !== undefined && value.scheduledAt !== null &&
        (typeof value.scheduledAt !== "string" || !Number.isFinite(Date.parse(value.scheduledAt)))) ||
      !["queued", "sending", "retry", "delivered", "dead"].includes(String(value.state)) ||
      !Number.isInteger(value.attempts) ||
      Number(value.attempts) < 0 ||
      Number(value.attempts) > 20 ||
      typeof value.nextAttemptAt !== "string" ||
      !Number.isFinite(Date.parse(value.nextAttemptAt)) ||
      typeof value.createdAt !== "string" ||
      typeof value.updatedAt !== "string" ||
      !Number.isFinite(Date.parse(value.createdAt)) ||
      !Number.isFinite(Date.parse(value.updatedAt)) ||
      (value.deliveredAt !== null &&
        (typeof value.deliveredAt !== "string" || !Number.isFinite(Date.parse(value.deliveredAt))))
    ) return null;
    return { ...value, scheduledAt: value.scheduledAt ?? null } as OutboxMessage;
  } catch {
    return null;
  }
}

export async function enqueueTransactionalMessage(input: {
  dedupeKey: string;
  accountId?: string | null;
  recipient: string;
  template: TransactionalMessageTemplate;
  title: string;
  text: string;
  actionLabel?: string | null;
  actionUrl?: string | null;
  scheduledAt?: string | null;
}) {
  const recipient = input.recipient.trim().toLowerCase();
  const title = cleanText(input.title, 160);
  const text = cleanText(input.text, 4000);
  if (
    !DEDUPE_PATTERN.test(input.dedupeKey) ||
    recipient.length > 254 ||
    !EMAIL_PATTERN.test(recipient) ||
    !title ||
    !text ||
    (input.accountId && input.accountId.length > 100)
  ) throw new Error("Invalid outbox message.");
  const now = new Date().toISOString();
  const scheduledAt = input.scheduledAt && Number.isFinite(Date.parse(input.scheduledAt))
    ? new Date(input.scheduledAt).toISOString()
    : null;
  const message: OutboxMessage = {
    schemaVersion: 1,
    messageId: `MSG-${randomUUID().replaceAll("-", "").slice(0, 24).toUpperCase()}`,
    dedupeKey: input.dedupeKey,
    accountId: input.accountId ?? null,
    recipient,
    template: input.template,
    title,
    text,
    actionLabel: input.actionLabel?.trim().slice(0, 80) || null,
    actionUrl: input.actionUrl?.trim().slice(0, 500) || null,
    scheduledAt,
    state: "queued",
    attempts: 0,
    nextAttemptAt: now,
    deliveredAt: null,
    lastErrorCode: null,
    createdAt: now,
    updatedAt: now,
  };
  const result = await redisCommand<Array<number | string>>([
    "EVAL",
    `
local existing = redis.call("GET", KEYS[1])
if existing then return {0, existing} end
redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[5])
redis.call("SET", KEYS[2], ARGV[2], "EX", ARGV[5])
redis.call("ZADD", KEYS[3], ARGV[3], ARGV[1])
redis.call("ZADD", KEYS[4], ARGV[3], ARGV[1])
return {1, ARGV[1]}
`,
    4,
    dedupeKey(input.dedupeKey),
    messageKey(message.messageId),
    dueIndexKey(),
    historyIndexKey(),
    message.messageId,
    JSON.stringify(message),
    Date.parse(now),
    input.dedupeKey,
    RETENTION_SECONDS,
  ]);
  if (!Array.isArray(result) || typeof result[1] !== "string") {
    throw new Error("Unable to enqueue transactional message.");
  }
  if (result[0] === 1) return { message, created: true };
  const existing = parseOutboxMessage(
    await redisCommand<string>(["GET", messageKey(result[1])]),
  );
  if (!existing || existing.dedupeKey !== input.dedupeKey) {
    throw new Error("Stored transactional message is invalid.");
  }
  return { message: existing, created: false };
}

async function claimMessage(messageId: string, now: number) {
  const result = await redisCommand<string>([
    "EVAL",
    `
local raw = redis.call("GET", KEYS[1])
if not raw then redis.call("ZREM", KEYS[2], ARGV[1]); return nil end
local ok, current = pcall(cjson.decode, raw)
if not ok or type(current) ~= "table" then return nil end
local state = tostring(current.state)
local due = redis.call("ZSCORE", KEYS[2], ARGV[1])
if not due or tonumber(due) > tonumber(ARGV[2]) then return nil end
if state ~= "queued" and state ~= "retry" and state ~= "sending" then return nil end
current.state = "sending"
current.attempts = tonumber(current.attempts or 0) + 1
current.nextAttemptAt = ARGV[3]
current.updatedAt = ARGV[4]
local encoded = cjson.encode(current)
redis.call("SET", KEYS[1], encoded, "EX", ARGV[5])
redis.call("ZADD", KEYS[2], ARGV[6], ARGV[1])
return encoded
`,
    2,
    messageKey(messageId),
    dueIndexKey(),
    messageId,
    now,
    new Date(now + 60_000).toISOString(),
    new Date(now).toISOString(),
    RETENTION_SECONDS,
    now + 60_000,
  ]);
  return parseOutboxMessage(result);
}

async function settleMessage(message: OutboxMessage, delivered: boolean, now: number) {
  const nextDelay = Math.min(24 * 60 * 60_000, 30_000 * 2 ** Math.min(message.attempts, 10));
  const terminal = delivered || message.attempts >= 8;
  const next: OutboxMessage = {
    ...message,
    state: delivered ? "delivered" : terminal ? "dead" : "retry",
    deliveredAt: delivered ? new Date(now).toISOString() : null,
    lastErrorCode: delivered ? null : "provider_error",
    nextAttemptAt: new Date(delivered || terminal ? now : now + nextDelay).toISOString(),
    updatedAt: new Date(now).toISOString(),
  };
  const result = await redisCommand<number>([
    "EVAL",
    `
local raw = redis.call("GET", KEYS[1])
if not raw then return 0 end
local ok, current = pcall(cjson.decode, raw)
if not ok or type(current) ~= "table" or current.state ~= "sending" or current.attempts ~= tonumber(ARGV[1]) then return 0 end
redis.call("SET", KEYS[1], ARGV[2], "EX", ARGV[3])
if ARGV[4] == "1" then redis.call("ZREM", KEYS[2], ARGV[5]) else redis.call("ZADD", KEYS[2], ARGV[6], ARGV[5]) end
return 1
`,
    2,
    messageKey(message.messageId),
    dueIndexKey(),
    message.attempts,
    JSON.stringify(next),
    RETENTION_SECONDS,
    terminal ? 1 : 0,
    message.messageId,
    Date.parse(next.nextAttemptAt),
  ]);
  return result === 1 ? next : null;
}

export async function processMessageOutbox(input: { limit?: number; now?: number } = {}) {
  const limit = input.limit ?? 20;
  const now = input.now ?? Date.now();
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) return null;
  const ids = (await redisCommand<string[]>([
    "ZRANGEBYSCORE",
    dueIndexKey(),
    "-inf",
    now,
    "LIMIT",
    0,
    limit,
  ])) ?? [];
  const stats = { processed: 0, delivered: 0, retried: 0, dead: 0, errors: 0 };
  for (const messageId of ids) {
    if (!MESSAGE_ID_PATTERN.test(messageId)) continue;
    const message = await claimMessage(messageId, now);
    if (!message) continue;
    stats.processed += 1;
    try {
      await sendTransactionalMessage({
        to: message.recipient,
        template: message.template,
        idempotencyKey: message.dedupeKey,
        title: message.title,
        text: message.text,
        actionLabel: message.actionLabel,
        actionUrl: message.actionUrl,
        scheduledAt: message.scheduledAt,
      });
      const settled = await settleMessage(message, true, Date.now());
      if (!settled) throw new Error("Message settlement conflicted.");
      stats.delivered += 1;
    } catch {
      const settled = await settleMessage(message, false, Date.now());
      if (settled?.state === "dead") stats.dead += 1;
      else if (settled?.state === "retry") stats.retried += 1;
      else stats.errors += 1;
    }
  }
  return stats;
}

export async function listOutboxMessages(input: { cursor?: string | null; limit?: number }) {
  const page = await listSortedSetPage({
    indexKey: historyIndexKey(),
    purpose: "outbox.history.v1",
    cursor: input.cursor,
    limit: input.limit ?? 30,
    pruneBeforeScore: Date.now() - RETENTION_SECONDS * 1000,
  });
  if (!page) return null;
  const raw = page.members.length
    ? ((await redisCommand<Array<string | null>>(["MGET", ...page.members.map(messageKey)])) ?? [])
    : [];
  return {
    messages: raw.map(parseOutboxMessage).filter((item): item is OutboxMessage => Boolean(item)),
    nextCursor: page.nextCursor,
  };
}
