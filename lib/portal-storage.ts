import { createHmac, randomUUID } from "node:crypto";
import { redisCommand } from "./redis";
import { listSortedSetPage } from "./sorted-set-pagination";

export type AccountAddress = {
  label: string;
  line1: string;
  line2: string | null;
  postalCode: string;
  city: string;
  country: string;
};

export type AccountPreferences = {
  emailAuctionStart: boolean;
  emailWin: boolean;
  emailOrderUpdates: boolean;
  marketing: boolean;
  analytics: boolean;
};

export type AccountProfile = {
  schemaVersion: 1;
  accountId: string;
  revision: number;
  fullName: string;
  phone: string;
  address: AccountAddress | null;
  preferences: AccountPreferences;
  deletionRequestedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AccountAdminRecord = {
  schemaVersion: 1;
  accountId: string;
  status: "active" | "blocked";
  internalNote: string | null;
  revision: number;
  updatedAt: string;
};

export type SupportTicketStatus = "open" | "in_progress" | "resolved";
export type SupportTicketCategory =
  | "account"
  | "auction"
  | "order"
  | "complaint"
  | "other";

export type SupportTicket = {
  schemaVersion: 1;
  ticketId: string;
  accountId: string;
  category: SupportTicketCategory;
  subject: string;
  message: string;
  orderId: string | null;
  status: SupportTicketStatus;
  adminNote: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9_-]{3,100}$/;
const AUCTION_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
const TICKET_ID_PATTERN = /^TKT-[A-F0-9]{24}$/;

function environmentName() {
  return process.env.VERCEL_ENV ?? "local";
}

function prefix() {
  return `fiszy:${environmentName()}`;
}

export async function consumeAccountRateLimit(input: {
  accountId: string;
  action: "profile" | "watchlist" | "support" | "notifications";
  limit: number;
  windowSeconds: number;
}) {
  const accountId = checkedAccountId(input.accountId);
  const salt = process.env.FISZY_RATE_LIMIT_SECRET?.trim() || "fiszy-local-rate-limit-v1";
  const fingerprint = createHmac("sha256", salt)
    .update(`portal:${input.action}:${accountId}`)
    .digest("hex")
    .slice(0, 32);
  const key = `${prefix()}:rate:v1:portal:${input.action}:${fingerprint}`;
  const attempts = await redisCommand<number>([
    "EVAL",
    `
local value = redis.call("INCR", KEYS[1])
if value == 1 then redis.call("EXPIRE", KEYS[1], ARGV[1]) end
return value
`,
    1,
    key,
    input.windowSeconds,
  ]);
  return Boolean(attempts && attempts <= input.limit);
}

function normalizeAccountId(value: unknown) {
  if (typeof value !== "string") return null;
  const accountId = value.trim();
  return ACCOUNT_ID_PATTERN.test(accountId) ? accountId : null;
}

function checkedAccountId(value: string) {
  const accountId = normalizeAccountId(value);
  if (!accountId) throw new Error("Invalid account id.");
  return accountId;
}

function accountProfileKey(accountId: string) {
  return `${prefix()}:account:${encodeURIComponent(checkedAccountId(accountId))}:profile`;
}

function accountIndexKey() {
  return `${prefix()}:index:v1:accounts`;
}

function accountWatchlistKey(accountId: string) {
  return `${prefix()}:account:${encodeURIComponent(checkedAccountId(accountId))}:watchlist`;
}

function accountReadNotificationsKey(accountId: string) {
  return `${prefix()}:account:${encodeURIComponent(checkedAccountId(accountId))}:notifications:read`;
}

function accountAdminKey(accountId: string) {
  return `${prefix()}:account:${encodeURIComponent(checkedAccountId(accountId))}:admin`;
}

function ticketKey(ticketId: string) {
  if (!TICKET_ID_PATTERN.test(ticketId)) throw new Error("Invalid ticket id.");
  return `${prefix()}:support:ticket:${ticketId}`;
}

function ticketIndexKey() {
  return `${prefix()}:index:v1:support-tickets`;
}

function accountTicketIndexKey(accountId: string) {
  return `${prefix()}:account:${encodeURIComponent(checkedAccountId(accountId))}:index:v1:support-tickets`;
}

function cleanText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length > maxLength || /[\u0000-\u001f\u007f]/.test(normalized)) {
    return null;
  }
  return normalized;
}

function optionalText(value: unknown, maxLength: number) {
  if (value === null || value === undefined || value === "") return "";
  return cleanText(value, maxLength);
}

function normalizeAddress(value: unknown): AccountAddress | null | undefined {
  if (value === null) return null;
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<AccountAddress>;
  const label = cleanText(candidate.label, 40);
  const line1 = cleanText(candidate.line1, 120);
  const line2 = optionalText(candidate.line2, 120);
  const postalCode = cleanText(candidate.postalCode, 20);
  const city = cleanText(candidate.city, 80);
  const country = cleanText(candidate.country, 80);
  if (!label || !line1 || line2 === null || !postalCode || !city || !country) {
    return undefined;
  }
  return { label, line1, line2: line2 || null, postalCode, city, country };
}

function defaultPreferences(): AccountPreferences {
  return {
    emailAuctionStart: true,
    emailWin: true,
    emailOrderUpdates: true,
    marketing: false,
    analytics: false,
  };
}

function normalizePreferences(value: unknown): AccountPreferences | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<AccountPreferences>;
  const keys = [
    "emailAuctionStart",
    "emailWin",
    "emailOrderUpdates",
    "marketing",
    "analytics",
  ] as const;
  if (keys.some((key) => typeof candidate[key] !== "boolean")) return null;
  return Object.fromEntries(keys.map((key) => [key, candidate[key]])) as unknown as AccountPreferences;
}

function validDate(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function parseProfile(raw: unknown): AccountProfile | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const candidate = JSON.parse(raw) as Partial<AccountProfile>;
    const accountId = normalizeAccountId(candidate.accountId);
    const fullName = optionalText(candidate.fullName, 100);
    const phone = optionalText(candidate.phone, 32);
    const address = normalizeAddress(candidate.address ?? null);
    const preferences = normalizePreferences(candidate.preferences);
    if (
      candidate.schemaVersion !== 1 ||
      !accountId ||
      !Number.isInteger(candidate.revision) ||
      Number(candidate.revision) < 1 ||
      fullName === null ||
      phone === null ||
      address === undefined ||
      !preferences ||
      !validDate(candidate.createdAt) ||
      !validDate(candidate.updatedAt) ||
      (candidate.deletionRequestedAt !== null && !validDate(candidate.deletionRequestedAt))
    ) {
      return null;
    }
    return {
      schemaVersion: 1,
      accountId,
      revision: Number(candidate.revision),
      fullName,
      phone,
      address,
      preferences,
      deletionRequestedAt: candidate.deletionRequestedAt ?? null,
      createdAt: candidate.createdAt as string,
      updatedAt: candidate.updatedAt as string,
    };
  } catch {
    return null;
  }
}

function newProfile(accountId: string, now = new Date().toISOString()): AccountProfile {
  return {
    schemaVersion: 1,
    accountId: checkedAccountId(accountId),
    revision: 1,
    fullName: "",
    phone: "",
    address: null,
    preferences: defaultPreferences(),
    deletionRequestedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

export async function ensureAccountProfile(accountIdValue: string) {
  const accountId = checkedAccountId(accountIdValue);
  const profile = newProfile(accountId);
  const result = await redisCommand<Array<number | string>>([
    "EVAL",
    `
local current = redis.call("GET", KEYS[1])
if current then return {0, current} end
redis.call("SET", KEYS[1], ARGV[1])
redis.call("ZADD", KEYS[2], ARGV[2], ARGV[3])
return {1, ARGV[1]}
`,
    2,
    accountProfileKey(accountId),
    accountIndexKey(),
    JSON.stringify(profile),
    Date.parse(profile.createdAt),
    accountId,
  ]);
  const stored = Array.isArray(result) ? parseProfile(result[1]) : null;
  if (!stored || stored.accountId !== accountId) {
    throw new Error("Stored account profile is invalid.");
  }
  return stored;
}

export async function readAccountProfile(accountIdValue: string) {
  const accountId = checkedAccountId(accountIdValue);
  const raw = await redisCommand<string>(["GET", accountProfileKey(accountId)]);
  const profile = parseProfile(raw);
  return profile?.accountId === accountId ? profile : null;
}

export type AccountProfilePatch = {
  fullName: string;
  phone: string;
  address: AccountAddress | null;
  preferences: AccountPreferences;
};

export function normalizeAccountProfilePatch(value: unknown): AccountProfilePatch | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<AccountProfilePatch>;
  const fullName = optionalText(candidate.fullName, 100);
  const phone = optionalText(candidate.phone, 32);
  const address = normalizeAddress(candidate.address ?? null);
  const preferences = normalizePreferences(candidate.preferences);
  if (fullName === null || phone === null || address === undefined || !preferences) return null;
  return { fullName, phone, address, preferences };
}

export async function updateAccountProfile(input: {
  accountId: string;
  expectedRevision: number;
  patch: AccountProfilePatch;
}) {
  const current = await ensureAccountProfile(input.accountId);
  if (current.revision !== input.expectedRevision) return null;
  const next: AccountProfile = {
    ...current,
    ...input.patch,
    revision: current.revision + 1,
    updatedAt: new Date().toISOString(),
  };
  const result = await redisCommand<number>([
    "EVAL",
    `
local raw = redis.call("GET", KEYS[1])
if not raw then return 0 end
local ok, current = pcall(cjson.decode, raw)
if not ok or type(current) ~= "table" or current.revision ~= tonumber(ARGV[1]) then return 0 end
redis.call("SET", KEYS[1], ARGV[2])
redis.call("ZADD", KEYS[2], ARGV[3], ARGV[4])
return 1
`,
    2,
    accountProfileKey(current.accountId),
    accountIndexKey(),
    current.revision,
    JSON.stringify(next),
    Date.parse(next.updatedAt),
    current.accountId,
  ]);
  return result === 1 ? next : null;
}

export async function requestAccountDeletion(accountIdValue: string) {
  const accountId = checkedAccountId(accountIdValue);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await ensureAccountProfile(accountId);
    if (current.deletionRequestedAt) return current;
    const next = {
      ...current,
      deletionRequestedAt: new Date().toISOString(),
      revision: current.revision + 1,
      updatedAt: new Date().toISOString(),
    } satisfies AccountProfile;
    const updated = await redisCommand<number>([
      "EVAL",
      `
local raw = redis.call("GET", KEYS[1])
if not raw then return 0 end
local ok, current = pcall(cjson.decode, raw)
if not ok or type(current) ~= "table" or current.revision ~= tonumber(ARGV[1]) then return 0 end
redis.call("SET", KEYS[1], ARGV[2])
return 1
`,
      1,
      accountProfileKey(accountId),
      current.revision,
      JSON.stringify(next),
    ]);
    if (updated === 1) return next;
  }
  throw new Error("Account profile changed during deletion request.");
}

export async function listAccountProfiles(input: { cursor?: string | null; limit?: number }) {
  const limit = input.limit ?? 20;
  const page = await listSortedSetPage({
    indexKey: accountIndexKey(),
    purpose: "portal.accounts.v1",
    cursor: input.cursor,
    limit,
  });
  if (!page) return null;
  if (page.members.length === 0) return { profiles: [], nextCursor: null };
  const raw = await redisCommand<Array<string | null>>([
    "MGET",
    ...page.members.map(accountProfileKey),
  ]);
  const profiles = (raw ?? []).flatMap((value, index) => {
    const profile = parseProfile(value);
    return profile?.accountId === page.members[index] ? [profile] : [];
  });
  return { profiles, nextCursor: page.nextCursor };
}

function defaultAccountAdminRecord(accountId: string): AccountAdminRecord {
  return {
    schemaVersion: 1,
    accountId: checkedAccountId(accountId),
    status: "active",
    internalNote: null,
    revision: 0,
    updatedAt: new Date(0).toISOString(),
  };
}

function parseAccountAdminRecord(raw: unknown, accountId: string) {
  if (raw === null || raw === undefined) return defaultAccountAdminRecord(accountId);
  if (typeof raw !== "string" || !raw) return null;
  try {
    const candidate = JSON.parse(raw) as Partial<AccountAdminRecord>;
    const note = optionalText(candidate.internalNote, 2000);
    if (
      candidate.schemaVersion !== 1 ||
      candidate.accountId !== accountId ||
      (candidate.status !== "active" && candidate.status !== "blocked") ||
      note === null ||
      !Number.isInteger(candidate.revision) ||
      Number(candidate.revision) < 1 ||
      !validDate(candidate.updatedAt)
    ) return null;
    return {
      schemaVersion: 1,
      accountId,
      status: candidate.status,
      internalNote: note || null,
      revision: Number(candidate.revision),
      updatedAt: candidate.updatedAt as string,
    } satisfies AccountAdminRecord;
  } catch {
    return null;
  }
}

export async function readAccountAdminRecord(accountIdValue: string) {
  const accountId = checkedAccountId(accountIdValue);
  const raw = await redisCommand<string>(["GET", accountAdminKey(accountId)]);
  const record = parseAccountAdminRecord(raw, accountId);
  if (!record) throw new Error("Stored account administration record is invalid.");
  return record;
}

export async function readAccountAdminRecords(accountIdValues: string[]) {
  const accountIds = accountIdValues.map(checkedAccountId);
  if (accountIds.length === 0) return [];
  if (accountIds.length > 50 || new Set(accountIds).size !== accountIds.length) {
    throw new Error("Invalid account administration batch.");
  }
  const raw = await redisCommand<Array<string | null>>([
    "MGET",
    ...accountIds.map(accountAdminKey),
  ]);
  const values = raw ?? [];
  if (values.length !== accountIds.length) throw new Error("Stored account administration batch is invalid.");
  return accountIds.map((accountId, index) => {
    const record = parseAccountAdminRecord(values[index], accountId);
    if (!record) throw new Error("Stored account administration record is invalid.");
    return record;
  });
}

export async function isAccountBlocked(accountIdValue: string) {
  return (await readAccountAdminRecord(accountIdValue)).status === "blocked";
}

export async function updateAccountAdminRecord(input: {
  accountId: string;
  expectedRevision: number;
  status: "active" | "blocked";
  internalNote: string | null;
}) {
  const accountId = checkedAccountId(input.accountId);
  const note = optionalText(input.internalNote, 2000);
  if (note === null || (input.status !== "active" && input.status !== "blocked")) return null;
  const current = await readAccountAdminRecord(accountId);
  if (current.revision !== input.expectedRevision) return null;
  const next: AccountAdminRecord = {
    schemaVersion: 1,
    accountId,
    status: input.status,
    internalNote: note || null,
    revision: current.revision + 1,
    updatedAt: new Date().toISOString(),
  };
  const result = await redisCommand<number>([
    "EVAL",
    `
local raw = redis.call("GET", KEYS[1])
if not raw and tonumber(ARGV[1]) ~= 0 then return 0 end
if raw then
  local ok, current = pcall(cjson.decode, raw)
  if not ok or type(current) ~= "table" or current.revision ~= tonumber(ARGV[1]) then return 0 end
end
redis.call("SET", KEYS[1], ARGV[2])
return 1
`,
    1,
    accountAdminKey(accountId),
    current.revision,
    JSON.stringify(next),
  ]);
  return result === 1 ? next : null;
}

export async function listWatchedAuctionIds(accountIdValue: string) {
  const accountId = checkedAccountId(accountIdValue);
  const members = await redisCommand<string[]>([
    "ZREVRANGE",
    accountWatchlistKey(accountId),
    0,
    199,
  ]);
  return (members ?? []).filter((member) => AUCTION_ID_PATTERN.test(member));
}

export async function setAuctionWatched(input: {
  accountId: string;
  auctionId: string;
  watched: boolean;
}) {
  const accountId = checkedAccountId(input.accountId);
  if (!AUCTION_ID_PATTERN.test(input.auctionId)) throw new Error("Invalid auction id.");
  await ensureAccountProfile(accountId);
  if (input.watched) {
    await redisCommand<number>([
      "EVAL",
      `
redis.call("ZADD", KEYS[1], ARGV[1], ARGV[2])
redis.call("ZREMRANGEBYRANK", KEYS[1], 0, -201)
return redis.call("ZCARD", KEYS[1])
`,
      1,
      accountWatchlistKey(accountId),
      Date.now(),
      input.auctionId,
    ]);
  } else {
    await redisCommand<number>([
      "ZREM",
      accountWatchlistKey(accountId),
      input.auctionId,
    ]);
  }
  return input.watched;
}

const NOTIFICATION_ID_PATTERN = /^[A-Za-z0-9:_-]{3,240}$/;

export function normalizeNotificationIds(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) return null;
  const ids = value.map((item) => typeof item === "string" ? item.trim() : "");
  if (ids.some((id) => !NOTIFICATION_ID_PATTERN.test(id))) return null;
  return [...new Set(ids)];
}

export async function listReadAccountNotificationIds(accountIdValue: string) {
  const accountId = checkedAccountId(accountIdValue);
  const values = await redisCommand<string[]>([
    "ZREVRANGE",
    accountReadNotificationsKey(accountId),
    0,
    499,
  ]);
  return (values ?? []).filter((id) => NOTIFICATION_ID_PATTERN.test(id));
}

export async function markAccountNotificationsRead(input: {
  accountId: string;
  notificationIds: string[];
}) {
  const accountId = checkedAccountId(input.accountId);
  const ids = normalizeNotificationIds(input.notificationIds);
  if (!ids) throw new Error("Invalid notification ids.");
  const key = accountReadNotificationsKey(accountId);
  const now = Date.now();
  const result = await redisCommand<number>([
    "EVAL",
    `
for index = 1, #ARGV, 2 do
  redis.call("ZADD", KEYS[1], ARGV[index], ARGV[index + 1])
end
redis.call("ZREMRANGEBYRANK", KEYS[1], 0, -501)
return redis.call("ZCARD", KEYS[1])
`,
    1,
    key,
    ...ids.flatMap((id, index) => [now + index, id]),
  ]);
  if (typeof result !== "number") throw new Error("Unable to mark notifications read.");
  return ids;
}

const TICKET_CATEGORIES = new Set<SupportTicketCategory>([
  "account",
  "auction",
  "order",
  "complaint",
  "other",
]);
const TICKET_STATUSES = new Set<SupportTicketStatus>(["open", "in_progress", "resolved"]);

function parseTicket(raw: unknown): SupportTicket | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const candidate = JSON.parse(raw) as Partial<SupportTicket>;
    const subject = cleanText(candidate.subject, 120);
    const message = cleanText(candidate.message, 3000);
    const orderId = optionalText(candidate.orderId, 200);
    const adminNote = optionalText(candidate.adminNote, 2000);
    if (
      candidate.schemaVersion !== 1 ||
      typeof candidate.ticketId !== "string" ||
      !TICKET_ID_PATTERN.test(candidate.ticketId) ||
      !normalizeAccountId(candidate.accountId) ||
      !TICKET_CATEGORIES.has(candidate.category as SupportTicketCategory) ||
      !subject ||
      !message ||
      orderId === null ||
      !TICKET_STATUSES.has(candidate.status as SupportTicketStatus) ||
      adminNote === null ||
      !Number.isInteger(candidate.revision) ||
      Number(candidate.revision) < 1 ||
      !validDate(candidate.createdAt) ||
      !validDate(candidate.updatedAt)
    ) return null;
    return {
      schemaVersion: 1,
      ticketId: candidate.ticketId,
      accountId: candidate.accountId as string,
      category: candidate.category as SupportTicketCategory,
      subject,
      message,
      orderId: orderId || null,
      status: candidate.status as SupportTicketStatus,
      adminNote: adminNote || null,
      revision: Number(candidate.revision),
      createdAt: candidate.createdAt as string,
      updatedAt: candidate.updatedAt as string,
    };
  } catch {
    return null;
  }
}

export async function readSupportTicket(ticketId: string) {
  if (!TICKET_ID_PATTERN.test(ticketId)) return null;
  return parseTicket(await redisCommand<string>(["GET", ticketKey(ticketId)]));
}

export function normalizeSupportTicketInput(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<SupportTicket>;
  const subject = cleanText(candidate.subject, 120);
  const message = cleanText(candidate.message, 3000);
  const orderId = optionalText(candidate.orderId, 200);
  if (!TICKET_CATEGORIES.has(candidate.category as SupportTicketCategory) || !subject || !message || orderId === null) {
    return null;
  }
  return {
    category: candidate.category as SupportTicketCategory,
    subject,
    message,
    orderId: orderId || null,
  };
}

export async function createSupportTicket(input: {
  accountId: string;
  category: SupportTicketCategory;
  subject: string;
  message: string;
  orderId: string | null;
}) {
  const accountId = checkedAccountId(input.accountId);
  await ensureAccountProfile(accountId);
  const now = new Date().toISOString();
  const ticket: SupportTicket = {
    schemaVersion: 1,
    ticketId: `TKT-${randomUUID().replaceAll("-", "").slice(0, 24).toUpperCase()}`,
    accountId,
    category: input.category,
    subject: input.subject,
    message: input.message,
    orderId: input.orderId,
    status: "open",
    adminNote: null,
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
  const score = Date.parse(now);
  const result = await redisCommand<number>([
    "EVAL",
    `
if redis.call("EXISTS", KEYS[1]) == 1 then return 0 end
redis.call("SET", KEYS[1], ARGV[1])
redis.call("ZADD", KEYS[2], ARGV[2], ARGV[3])
redis.call("ZADD", KEYS[3], ARGV[2], ARGV[3])
return 1
`,
    3,
    ticketKey(ticket.ticketId),
    ticketIndexKey(),
    accountTicketIndexKey(accountId),
    JSON.stringify(ticket),
    score,
    ticket.ticketId,
  ]);
  if (result !== 1) throw new Error("Unable to create a unique support ticket.");
  return ticket;
}

async function listTicketPage(input: {
  indexKey: string;
  purpose: string;
  cursor?: string | null;
  limit?: number;
  accountId?: string;
}) {
  const page = await listSortedSetPage({
    indexKey: input.indexKey,
    purpose: input.purpose,
    cursor: input.cursor,
    limit: input.limit ?? 20,
  });
  if (!page) return null;
  if (page.members.length === 0) return { tickets: [], nextCursor: null };
  const raw = await redisCommand<Array<string | null>>(["MGET", ...page.members.map(ticketKey)]);
  const tickets = (raw ?? []).flatMap((value, index) => {
    const ticket = parseTicket(value);
    return ticket?.ticketId === page.members[index] && (!input.accountId || ticket.accountId === input.accountId)
      ? [ticket]
      : [];
  });
  return { tickets, nextCursor: page.nextCursor };
}

export async function listAccountTickets(input: {
  accountId: string;
  cursor?: string | null;
  limit?: number;
}) {
  const accountId = checkedAccountId(input.accountId);
  return listTicketPage({
    indexKey: accountTicketIndexKey(accountId),
    purpose: `portal.account-tickets.v1:${accountId}`,
    cursor: input.cursor,
    limit: input.limit,
    accountId,
  });
}

export async function listSupportTickets(input: { cursor?: string | null; limit?: number }) {
  return listTicketPage({
    indexKey: ticketIndexKey(),
    purpose: "portal.support-tickets.v1",
    cursor: input.cursor,
    limit: input.limit,
  });
}

export async function updateSupportTicket(input: {
  ticketId: string;
  expectedRevision: number;
  status: SupportTicketStatus;
  adminNote: string | null;
}) {
  if (!TICKET_ID_PATTERN.test(input.ticketId) || !TICKET_STATUSES.has(input.status)) return null;
  const note = optionalText(input.adminNote, 2000);
  if (note === null) return null;
  const raw = await redisCommand<string>(["GET", ticketKey(input.ticketId)]);
  const current = parseTicket(raw);
  if (!current || current.revision !== input.expectedRevision) return null;
  const next: SupportTicket = {
    ...current,
    status: input.status,
    adminNote: note || null,
    revision: current.revision + 1,
    updatedAt: new Date().toISOString(),
  };
  const result = await redisCommand<number>([
    "EVAL",
    `
local raw = redis.call("GET", KEYS[1])
if not raw then return 0 end
local ok, current = pcall(cjson.decode, raw)
if not ok or type(current) ~= "table" or current.revision ~= tonumber(ARGV[1]) then return 0 end
redis.call("SET", KEYS[1], ARGV[2])
return 1
`,
    1,
    ticketKey(input.ticketId),
    current.revision,
    JSON.stringify(next),
  ]);
  return result === 1 ? next : null;
}
