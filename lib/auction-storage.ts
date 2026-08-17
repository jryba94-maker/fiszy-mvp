import {
  AUCTION_ID,
  LEGACY_AUCTION_ID,
  type AuctionConfig,
  type AuctionRecord,
  defaultAuctionConfig,
  defaultAuctionDefinition,
  legacyAuctionRecord,
  normalizeAuctionId,
  normalizeRunId,
  parseAuctionDefinition,
} from "./auction";
import type { AuctionOrder } from "./order-storage";
import {
  normalizePaymentProvider,
  storedPaymentProvider,
  type PaymentProviderName,
} from "./payment-types";
import { redisCommand } from "./redis";
import { listSortedSetPage } from "./sorted-set-pagination";

export type AuctionWinner = {
  bidderId: string;
  price: number;
  claimedAt: string;
  paymentStatus?: "pending" | "paid";
  paymentProvider?: PaymentProviderName;
  paymentReference?: string;
  paymentSessionId?: string;
  paymentCheckoutUrl?: string;
  paymentExpiresAt?: string;
  paidAt?: string;
};

export type AuctionEntry = {
  bidderId: string;
  fee: number;
  grantedAt: string;
  provider?: PaymentProviderName;
  paymentReference?: string;
  paymentSessionId?: string;
};

export type ParticipantRunRecord = {
  schemaVersion: 1;
  participantId: string;
  auctionId: string;
  runId: string;
  entryStatus: "granted" | "refunded";
  entryFee: number;
  entryPaymentProvider?: PaymentProviderName;
  entryPaymentReference?: string;
  entryPaymentSessionId: string;
  grantedAt?: string;
  refundedAt?: string;
};

export type AuctionRunHistoryOutcome = {
  runId: string;
  winner: AuctionWinner | null;
  order: AuctionOrder | null;
};

export type AuctionRunHistoryDetail = AuctionRunHistoryOutcome & {
  participantCount: number;
};

type IndexedHistoryValue<T> = {
  member: string;
  score: number;
  value: T;
};

const HISTORY_CURSOR_PREFIX = "h1.";
const MAX_HISTORY_CURSOR_LENGTH = 1024;
const HISTORY_PAGE_SCAN_FACTOR = 4;
const MAX_HISTORY_PAGE_SCAN = 200;

function normalizeParticipantId(value: unknown) {
  if (typeof value !== "string") return null;
  const participantId = value.trim();
  return participantId && participantId.length <= 100 ? participantId : null;
}

function environmentName() {
  return process.env.VERCEL_ENV ?? "local";
}

function prefix() {
  return `fiszy:${environmentName()}`;
}

function checkedAuctionId(value: string) {
  const auctionId = normalizeAuctionId(value);
  if (!auctionId) throw new Error("Invalid auction id.");
  return auctionId;
}

function checkedRunId(value: string) {
  const runId = normalizeRunId(value);
  if (!runId) throw new Error("Invalid auction run id.");
  return runId;
}

export function auctionRecordKey(auctionId: string = AUCTION_ID) {
  return `${prefix()}:auction:${checkedAuctionId(auctionId)}:record`;
}

export function auctionConfigKey(auctionId: string = AUCTION_ID) {
  return `${prefix()}:auction:${checkedAuctionId(auctionId)}:config`;
}

export function auctionRunConfigKey(
  runId: string,
  auctionId: string = AUCTION_ID,
) {
  return `${prefix()}:auction:${checkedAuctionId(auctionId)}:run:${checkedRunId(runId)}:config`;
}

export function winnerKey(runId: string, auctionId: string = AUCTION_ID) {
  return `${prefix()}:auction:${checkedAuctionId(auctionId)}:run:${checkedRunId(runId)}:winner`;
}

export function entryKey(
  runId: string,
  bidderId: string,
  auctionId: string = AUCTION_ID,
) {
  return `${prefix()}:auction:${checkedAuctionId(auctionId)}:run:${checkedRunId(runId)}:entry:${encodeURIComponent(bidderId)}`;
}

function auctionsIndexKey() {
  return `${prefix()}:index:v1:auctions:all`;
}

function catalogIndexKey() {
  return `${prefix()}:index:v1:catalog`;
}

function runsIndexKey() {
  return `${prefix()}:index:v1:runs`;
}

function auctionRunsIndexKey(auctionId: string) {
  return `${prefix()}:auction:${checkedAuctionId(auctionId)}:index:v1:runs`;
}

function participantHistoryIndexKey(participantId: string) {
  return `${prefix()}:participant:${encodeURIComponent(participantId)}:index:v1:runs`;
}

function participantRunKey(
  participantId: string,
  auctionId: string,
  runId: string,
) {
  return `${prefix()}:participant:${encodeURIComponent(participantId)}:run:${checkedAuctionId(auctionId)}:${checkedRunId(runId)}`;
}

function runParticipantsIndexKey(auctionId: string, runId: string) {
  return `${prefix()}:auction:${checkedAuctionId(auctionId)}:run:${checkedRunId(runId)}:index:v1:participants`;
}

function runParticipantCountKey(auctionId: string, runId: string) {
  return `${prefix()}:auction:${checkedAuctionId(auctionId)}:run:${checkedRunId(runId)}:participants:v1:count`;
}

function runParticipantVersionKey(auctionId: string, runId: string) {
  return `${prefix()}:auction:${checkedAuctionId(auctionId)}:run:${checkedRunId(runId)}:participants:v1:version`;
}

function auctionRunOrderKey(auctionId: string, runId: string) {
  return `${prefix()}:auction:${checkedAuctionId(auctionId)}:run:${checkedRunId(runId)}:order`;
}

function runReference(auctionId: string, runId: string) {
  return `${checkedAuctionId(auctionId)}|${checkedRunId(runId)}`;
}

function normalizeAuctionConfig(value: unknown): AuctionConfig | null {
  if (!value || typeof value !== "object") return null;

  const candidate = value as Partial<AuctionConfig>;
  if (
    typeof candidate.runId !== "string" ||
    !normalizeRunId(candidate.runId) ||
    typeof candidate.startsAt !== "string" ||
    !Number.isFinite(new Date(candidate.startsAt).getTime())
  ) {
    return null;
  }

  const definitionKeys = [
    "productName",
    "productImageUrl",
    "regularPrice",
    "startPrice",
    "floorPrice",
    "durationMinutes",
  ] as const;
  const isTimingOnlyLegacyConfig =
    candidate.schemaVersion === undefined &&
    definitionKeys.every(
      (key) => !Object.prototype.hasOwnProperty.call(candidate, key),
    );
  if (!isTimingOnlyLegacyConfig && candidate.schemaVersion !== 2) return null;
  const definition = isTimingOnlyLegacyConfig
    ? defaultAuctionDefinition()
    : parseAuctionDefinition(candidate);
  if (!definition) return null;

  return {
    schemaVersion: 2,
    runId: candidate.runId,
    startsAt: candidate.startsAt,
    ...definition,
  };
}

export function parseStoredAuctionConfig(raw: unknown): AuctionConfig | null {
  if (typeof raw !== "string" || !raw) return null;

  try {
    return normalizeAuctionConfig(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

function normalizeAuctionRecord(value: unknown): AuctionRecord | null {
  if (!value || typeof value !== "object") return null;

  const candidate = value as Partial<AuctionRecord>;
  const auctionId = normalizeAuctionId(candidate.auctionId);
  const definition = parseAuctionDefinition(candidate);
  const currentRunId =
    candidate.currentRunId === null
      ? null
      : normalizeRunId(candidate.currentRunId);

  if (
    !auctionId ||
    !definition ||
    (candidate.state !== "draft" &&
      candidate.state !== "published" &&
      candidate.state !== "archived") ||
    currentRunId === null && candidate.currentRunId !== null ||
    typeof candidate.revision !== "number" ||
    !Number.isInteger(candidate.revision) ||
    candidate.revision < 1 ||
    typeof candidate.createdAt !== "string" ||
    !Number.isFinite(new Date(candidate.createdAt).getTime()) ||
    typeof candidate.updatedAt !== "string" ||
    !Number.isFinite(new Date(candidate.updatedAt).getTime())
  ) {
    return null;
  }

  return {
    schemaVersion: 1,
    auctionId,
    state: candidate.state,
    currentRunId,
    revision: candidate.revision,
    createdAt: candidate.createdAt,
    updatedAt: candidate.updatedAt,
    ...definition,
  };
}

export function parseStoredAuctionRecord(raw: unknown): AuctionRecord | null {
  if (typeof raw !== "string" || !raw) return null;

  try {
    return normalizeAuctionRecord(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

function normalizeParticipantRunRecord(
  value: unknown,
): ParticipantRunRecord | null {
  if (!value || typeof value !== "object") return null;

  const candidate = value as Partial<ParticipantRunRecord>;
  const participantId = normalizeParticipantId(candidate.participantId);
  const auctionId = normalizeAuctionId(candidate.auctionId);
  const runId = normalizeRunId(candidate.runId);
  const grantedAt =
    typeof candidate.grantedAt === "string" &&
    Number.isFinite(new Date(candidate.grantedAt).getTime())
      ? candidate.grantedAt
      : null;
  const refundedAt =
    typeof candidate.refundedAt === "string" &&
    Number.isFinite(new Date(candidate.refundedAt).getTime())
      ? candidate.refundedAt
      : null;
  const explicitPaymentProvider = candidate.entryPaymentProvider === undefined
    ? undefined
    : normalizePaymentProvider(candidate.entryPaymentProvider);
  const entryPaymentProvider = explicitPaymentProvider ?? storedPaymentProvider(
    candidate.entryPaymentProvider,
    Boolean(candidate.entryPaymentSessionId),
  );
  const entryPaymentReference = candidate.entryPaymentReference ??
    candidate.entryPaymentSessionId;

  if (
    candidate.schemaVersion !== 1 ||
    !participantId ||
    !auctionId ||
    !runId ||
    (candidate.entryStatus !== "granted" &&
      candidate.entryStatus !== "refunded") ||
    typeof candidate.entryFee !== "number" ||
    !Number.isFinite(candidate.entryFee) ||
    candidate.entryFee < 0 ||
    typeof candidate.entryPaymentSessionId !== "string" ||
    (candidate.entryPaymentProvider !== undefined && !explicitPaymentProvider) ||
    (entryPaymentReference !== undefined &&
      (typeof entryPaymentReference !== "string" ||
        entryPaymentReference.length > 200 ||
        /[\u0000-\u001f\u007f]/.test(entryPaymentReference))) ||
    (candidate.entryStatus === "granted" && !grantedAt) ||
    (candidate.entryStatus === "refunded" && !refundedAt) ||
    (candidate.grantedAt !== undefined && !grantedAt) ||
    (candidate.refundedAt !== undefined && !refundedAt)
  ) {
    return null;
  }

  return {
    schemaVersion: 1,
    participantId,
    auctionId,
    runId,
    entryStatus: candidate.entryStatus,
    entryFee: candidate.entryFee,
    ...(entryPaymentProvider
      ? { entryPaymentProvider }
      : {}),
    ...(entryPaymentReference
      ? { entryPaymentReference }
      : {}),
    entryPaymentSessionId: candidate.entryPaymentSessionId,
    ...(grantedAt ? { grantedAt } : {}),
    ...(refundedAt ? { refundedAt } : {}),
  };
}

function normalizeAuctionWinner(value: unknown): AuctionWinner | null {
  if (!value || typeof value !== "object") return null;

  const candidate = value as Partial<AuctionWinner>;
  const bidderId = normalizeParticipantId(candidate.bidderId);
  const claimedAt =
    typeof candidate.claimedAt === "string" &&
    Number.isFinite(new Date(candidate.claimedAt).getTime())
      ? candidate.claimedAt
      : null;
  const explicitPaymentProvider = candidate.paymentProvider === undefined
    ? undefined
    : normalizePaymentProvider(candidate.paymentProvider);
  const paymentProvider = explicitPaymentProvider ?? storedPaymentProvider(
    candidate.paymentProvider,
    Boolean(candidate.paymentSessionId),
  );
  const paymentReference = candidate.paymentReference ??
    candidate.paymentSessionId;
  if (
    !bidderId ||
    typeof candidate.price !== "number" ||
    !Number.isFinite(candidate.price) ||
    candidate.price < 0 ||
    !claimedAt ||
    (candidate.paymentStatus !== undefined &&
      candidate.paymentStatus !== "pending" &&
      candidate.paymentStatus !== "paid") ||
    (candidate.paymentProvider !== undefined && !explicitPaymentProvider) ||
    (paymentReference !== undefined &&
      (typeof paymentReference !== "string" ||
        !paymentReference ||
        paymentReference.length > 200 ||
        /[\u0000-\u001f\u007f]/.test(paymentReference)))
  ) {
    return null;
  }

  const optionalStrings = [
    "paymentSessionId",
    "paymentCheckoutUrl",
    "paymentExpiresAt",
    "paidAt",
  ] as const;
  if (
    optionalStrings.some(
      (key) =>
        candidate[key] !== undefined && typeof candidate[key] !== "string",
    ) ||
    (candidate.paymentExpiresAt !== undefined &&
      !Number.isFinite(new Date(candidate.paymentExpiresAt).getTime())) ||
    (candidate.paidAt !== undefined &&
      !Number.isFinite(new Date(candidate.paidAt).getTime()))
  ) {
    return null;
  }

  return {
    bidderId,
    price: candidate.price,
    claimedAt,
    ...(candidate.paymentStatus
      ? { paymentStatus: candidate.paymentStatus }
      : {}),
    ...(paymentProvider ? { paymentProvider } : {}),
    ...(paymentReference ? { paymentReference } : {}),
    ...(candidate.paymentSessionId !== undefined
      ? { paymentSessionId: candidate.paymentSessionId }
      : {}),
    ...(candidate.paymentCheckoutUrl !== undefined
      ? { paymentCheckoutUrl: candidate.paymentCheckoutUrl }
      : {}),
    ...(candidate.paymentExpiresAt !== undefined
      ? { paymentExpiresAt: candidate.paymentExpiresAt }
      : {}),
    ...(candidate.paidAt !== undefined ? { paidAt: candidate.paidAt } : {}),
  };
}

function parseStoredAuctionWinner(raw: unknown) {
  if (typeof raw !== "string" || !raw) return null;
  try {
    return normalizeAuctionWinner(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

function parseStoredHistoryOrder(
  raw: unknown,
  auctionId: string,
  runId: string,
): AuctionOrder | null {
  if (typeof raw !== "string" || !raw) return null;

  try {
    const candidate = JSON.parse(raw) as Partial<AuctionOrder>;
    if (
      typeof candidate.orderId !== "string" ||
      !candidate.orderId.trim() ||
      candidate.orderId.length > 200 ||
      /[\u0000-\u001f\u007f]/.test(candidate.orderId) ||
      candidate.auctionId !== auctionId ||
      candidate.runId !== runId ||
      normalizeParticipantId(candidate.bidderId) !== candidate.bidderId ||
      typeof candidate.amount !== "number" ||
      !Number.isFinite(candidate.amount) ||
      candidate.amount < 0 ||
      candidate.currency !== "pln" ||
      typeof candidate.paidAt !== "string" ||
      !Number.isFinite(new Date(candidate.paidAt).getTime())
    ) {
      return null;
    }
    return candidate as AuctionOrder;
  } catch {
    return null;
  }
}

function encodeHistoryCursor(purpose: string, score: number, member: string) {
  const payload = Buffer.from(
    JSON.stringify({ purpose, score, member }),
    "utf8",
  ).toString("base64url");
  return `${HISTORY_CURSOR_PREFIX}${payload}`;
}

function parseHistoryCursor(
  cursor: string | null | undefined,
  purpose: string,
) {
  if (cursor === null || cursor === undefined) {
    return { kind: "offset" as const, offset: 0 };
  }
  if (/^\d+$/.test(cursor)) {
    const offset = Number(cursor);
    return Number.isSafeInteger(offset)
      ? { kind: "offset" as const, offset }
      : null;
  }
  if (
    cursor.length > MAX_HISTORY_CURSOR_LENGTH ||
    !cursor.startsWith(HISTORY_CURSOR_PREFIX)
  ) {
    return null;
  }

  const encoded = cursor.slice(HISTORY_CURSOR_PREFIX.length);
  if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) return null;
  try {
    const decoded = Buffer.from(encoded, "base64url");
    if (decoded.toString("base64url") !== encoded) return null;
    const value = JSON.parse(
      decoded.toString("utf8"),
    ) as { purpose?: unknown; score?: unknown; member?: unknown };
    if (
      value.purpose !== purpose ||
      typeof value.score !== "number" ||
      !Number.isFinite(value.score) ||
      typeof value.member !== "string" ||
      !value.member
    ) {
      return null;
    }
    return {
      kind: "keyset" as const,
      score: value.score,
      member: value.member,
    };
  } catch {
    return null;
  }
}

const HISTORY_PAGE_WINDOW_SCRIPT = `
local cursorMember = ARGV[1]
local cursorScore = ARGV[2]
local legacyOffset = tonumber(ARGV[3]) or 0
local scanLimit = tonumber(ARGV[4])
local values

if cursorMember ~= "" then
  local previousScore = redis.call("ZSCORE", KEYS[1], cursorMember)
  redis.call("ZADD", KEYS[1], cursorScore, cursorMember)
  local rank = redis.call("ZREVRANK", KEYS[1], cursorMember)
  local start = rank + 1
  values = redis.call("ZREVRANGE", KEYS[1], start, start + scanLimit, "WITHSCORES")
  if previousScore then
    redis.call("ZADD", KEYS[1], previousScore, cursorMember)
  else
    redis.call("ZREM", KEYS[1], cursorMember)
  end
else
  values = redis.call("ZREVRANGE", KEYS[1], legacyOffset, legacyOffset + scanLimit, "WITHSCORES")
end

local result = {1}
for _, value in ipairs(values) do
  table.insert(result, value)
end
return result
`;

async function readIndexedHistoryPage<T>(input: {
  indexKey: string;
  cursor?: string | null;
  purpose: string;
  limit: number;
  normalizeMember: (value: unknown) => string | null;
  valueKey: (member: string) => string;
  parseValue: (raw: unknown, member: string) => T | null;
}) {
  const cursor = parseHistoryCursor(input.cursor, input.purpose);
  if (!cursor) return null;
  if (cursor.kind === "keyset") {
    const normalizedCursorMember = input.normalizeMember(cursor.member);
    if (!normalizedCursorMember || normalizedCursorMember !== cursor.member) {
      return null;
    }
  }

  const scanLimit = Math.min(
    MAX_HISTORY_PAGE_SCAN,
    Math.max(input.limit + 1, input.limit * HISTORY_PAGE_SCAN_FACTOR),
  );
  const stored = await redisCommand<Array<number | string>>([
    "EVAL",
    HISTORY_PAGE_WINDOW_SCRIPT,
    1,
    input.indexKey,
    cursor.kind === "keyset" ? cursor.member : "",
    cursor.kind === "keyset" ? cursor.score : "",
    cursor.kind === "offset" ? cursor.offset : 0,
    scanLimit,
  ]);
  if (!Array.isArray(stored) || stored[0] !== 1) {
    throw new Error("Stored history page is invalid.");
  }

  const rawValues = stored.slice(1);
  if (rawValues.length % 2 !== 0) {
    throw new Error("Stored history index is invalid.");
  }

  const candidates: Array<{ member: string; score: number }> = [];
  for (let index = 0; index < rawValues.length; index += 2) {
    const rawMember = rawValues[index];
    const member = typeof rawMember === "string" ? rawMember : "";
    const score = Number(rawValues[index + 1]);
    if (!member || !Number.isFinite(score)) {
      throw new Error("Stored history index member is invalid.");
    }
    candidates.push({ member, score });
  }

  const hasMoreAfterWindow = candidates.length > scanLimit;
  const window = candidates.slice(0, scanLimit);
  const recordCandidates = window.flatMap((candidate, index) => {
    const member = input.normalizeMember(candidate.member);
    return member && member === candidate.member
      ? [{ index, member, key: input.valueKey(member) }]
      : [];
  });
  const storedRecords = recordCandidates.length > 0
    ? await redisCommand<Array<string | null>>([
        "MGET",
        ...recordCandidates.map(({ key }) => key),
      ])
    : [];
  if (!storedRecords || storedRecords.length !== recordCandidates.length) {
    throw new Error("Stored history page records are invalid.");
  }

  const valuesByIndex = new Map<number, T>();
  recordCandidates.forEach((candidate, recordIndex) => {
    const value = input.parseValue(
      storedRecords[recordIndex],
      candidate.member,
    );
    if (value) valuesByIndex.set(candidate.index, value);
  });

  const page: IndexedHistoryValue<T>[] = [];
  const invalidMembers: string[] = [];
  let lastProcessed: { member: string; score: number } | null = null;
  let foundExtraValue = false;
  for (let index = 0; index < window.length; index += 1) {
    const candidate = window[index];
    const value = valuesByIndex.get(index);
    if (value && page.length >= input.limit) {
      foundExtraValue = true;
      break;
    }

    lastProcessed = candidate;
    if (value) {
      page.push({ ...candidate, value });
    } else {
      invalidMembers.push(candidate.member);
    }
  }

  const hasMore = foundExtraValue || hasMoreAfterWindow;
  const boundary = hasMore
    ? page.at(-1) ?? lastProcessed
    : null;
  return {
    page,
    invalidMembers,
    nextCursor: boundary
      ? encodeHistoryCursor(input.purpose, boundary.score, boundary.member)
      : null,
  };
}

function parseStoredCounter(value: unknown, label: string) {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Stored ${label} is invalid.`);
  }
  return parsed;
}

const BACKFILL_PARTICIPANT_COUNT_SCRIPT = `
local cached = redis.call("GET", KEYS[2])
if cached then return {2, cached} end

local versionRaw = redis.call("GET", KEYS[3])
local version = tonumber(versionRaw or "0")
local expectedVersion = tonumber(ARGV[1])
local validCount = tonumber(ARGV[2])
if not version or version < 0 or math.floor(version) ~= version then return {-1} end
if not expectedVersion or version ~= expectedVersion then return {0} end
if not validCount or validCount < 0 or math.floor(validCount) ~= validCount then return {-1} end

local removed = 0
for argumentIndex = 3, #ARGV do
  removed = removed + redis.call("ZREM", KEYS[1], ARGV[argumentIndex])
end
redis.call("SET", KEYS[3], version + removed)
redis.call("SET", KEYS[2], validCount)
return {1, validCount}
`;

async function backfillRunParticipantCount(
  auctionId: string,
  runId: string,
  expectedVersion: number,
) {
  const storedMembers = await redisCommand<string[]>([
    "ZRANGE",
    runParticipantsIndexKey(auctionId, runId),
    0,
    -1,
  ]);
  const members = storedMembers ?? [];
  if (members.some((member) => typeof member !== "string" || !member)) {
    throw new Error("Stored auction participant index is invalid.");
  }

  const recordCandidates = members.flatMap((member, index) => {
    const participantId = normalizeParticipantId(member);
    return participantId && participantId === member
      ? [{ index, participantId, key: participantRunKey(participantId, auctionId, runId) }]
      : [];
  });
  const storedRecords = recordCandidates.length > 0
    ? await redisCommand<Array<string | null>>([
        "MGET",
        ...recordCandidates.map(({ key }) => key),
      ])
    : [];
  if (!storedRecords || storedRecords.length !== recordCandidates.length) {
    throw new Error("Stored auction participant records are invalid.");
  }

  const validIndexes = new Set<number>();
  recordCandidates.forEach((candidate, recordIndex) => {
    const raw = storedRecords[recordIndex];
    if (typeof raw !== "string" || !raw) return;
    try {
      const participant = normalizeParticipantRunRecord(
        JSON.parse(raw) as unknown,
      );
      if (
        participant?.participantId === candidate.participantId &&
        participant.auctionId === auctionId &&
        participant.runId === runId
      ) {
        validIndexes.add(candidate.index);
      }
    } catch {
      // The same canonical validator is used by the paged reader below.
    }
  });

  const invalidMembers = members.filter((_, index) => !validIndexes.has(index));
  const result = await redisCommand<Array<number | string>>([
    "EVAL",
    BACKFILL_PARTICIPANT_COUNT_SCRIPT,
    3,
    runParticipantsIndexKey(auctionId, runId),
    runParticipantCountKey(auctionId, runId),
    runParticipantVersionKey(auctionId, runId),
    expectedVersion,
    validIndexes.size,
    ...invalidMembers,
  ]);
  if (!Array.isArray(result) || result.length < 1) {
    throw new Error("Stored auction participant count backfill is invalid.");
  }
  const status = Number(result[0]);
  if (status === 0) return null;
  if (status !== 1 && status !== 2) {
    throw new Error("Stored auction participant count could not be repaired.");
  }
  return parseStoredCounter(result[1], "auction participant count");
}

async function readRunParticipantCounterState(
  auctionId: string,
  runIds: string[],
) {
  const keys = runIds.flatMap((runId) => [
    runParticipantCountKey(auctionId, runId),
    runParticipantVersionKey(auctionId, runId),
  ]);
  const stored = keys.length > 0
    ? await redisCommand<Array<string | null>>(["MGET", ...keys])
    : [];
  if (!stored || stored.length !== keys.length) {
    throw new Error("Stored auction participant counters are invalid.");
  }
  return runIds.map((runId, index) => ({
    runId,
    count: parseStoredCounter(
      stored[index * 2],
      "auction participant count",
    ),
    version: parseStoredCounter(
      stored[index * 2 + 1],
      "auction participant version",
    ) ?? 0,
  }));
}

async function ensureRunParticipantCounts(
  runIdValues: string[],
  auctionIdValue: string,
) {
  const auctionId = checkedAuctionId(auctionIdValue);
  const runIds = runIdValues.map(checkedRunId);
  if (runIds.length > 50 || new Set(runIds).size !== runIds.length) {
    throw new Error("Invalid auction participant count batch.");
  }

  let states = await readRunParticipantCounterState(auctionId, runIds);
  for (let index = 0; index < states.length; index += 1) {
    if (states[index].count !== null) continue;

    let repaired: number | null = null;
    for (let attempt = 0; attempt < 3 && repaired === null; attempt += 1) {
      repaired = await backfillRunParticipantCount(
        auctionId,
        states[index].runId,
        states[index].version,
      );
      if (repaired === null) {
        const refreshed = await readRunParticipantCounterState(
          auctionId,
          [states[index].runId],
        );
        states[index] = refreshed[0];
        repaired = states[index].count;
      }
    }
    if (repaired === null) {
      throw new Error("Auction participant count changed during backfill.");
    }
    states[index] = { ...states[index], count: repaired };
  }

  return states.map(({ count }) => {
    if (count === null) throw new Error("Auction participant count is missing.");
    return count;
  });
}

const CLEAN_INVALID_PARTICIPANTS_SCRIPT = `
local removed = 0
for argumentIndex = 1, #ARGV do
  removed = removed + redis.call("ZREM", KEYS[1], ARGV[argumentIndex])
end
if removed == 0 then
  local unchanged = redis.call("GET", KEYS[2])
  return {0, unchanged or -1}
end

local version = tonumber(redis.call("GET", KEYS[3]) or "0")
if not version or version < 0 or math.floor(version) ~= version then version = 0 end
redis.call("SET", KEYS[3], version + removed)

local count = tonumber(redis.call("GET", KEYS[2]) or "")
if not count or count < removed or math.floor(count) ~= count then
  redis.call("DEL", KEYS[2])
  return {removed, -1}
end
redis.call("SET", KEYS[2], count - removed)
return {removed, count - removed}
`;

async function cleanInvalidParticipantMembers(
  auctionId: string,
  runId: string,
  members: string[],
) {
  if (members.length === 0) return null;
  const uniqueMembers = [...new Set(members)];
  const result = await redisCommand<Array<number | string>>([
    "EVAL",
    CLEAN_INVALID_PARTICIPANTS_SCRIPT,
    3,
    runParticipantsIndexKey(auctionId, runId),
    runParticipantCountKey(auctionId, runId),
    runParticipantVersionKey(auctionId, runId),
    ...uniqueMembers,
  ]);
  if (!Array.isArray(result) || result.length !== 2) {
    throw new Error("Stored auction participant cleanup is invalid.");
  }
  const count = Number(result[1]);
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
}

async function cleanInvalidRunMembers(
  auctionId: string,
  members: string[],
) {
  if (members.length === 0) return;
  const uniqueMembers = [...new Set(members)];
  const script = `
local removed = 0
for argumentIndex = 2, #ARGV do
  removed = removed + redis.call("ZREM", KEYS[1], ARGV[argumentIndex])
  redis.call("ZREM", KEYS[2], ARGV[1] .. "|" .. ARGV[argumentIndex])
end
return removed
`;
  await redisCommand<number>([
    "EVAL",
    script,
    2,
    auctionRunsIndexKey(auctionId),
    runsIndexKey(),
    auctionId,
    ...uniqueMembers,
  ]);
}

async function readStoredAuctionConfig(auctionId: string) {
  const raw = await redisCommand<string>(["GET", auctionConfigKey(auctionId)]);
  return {
    found: raw !== null,
    config: parseStoredAuctionConfig(raw),
  };
}

export async function readOptionalAuctionConfig(auctionId: string) {
  const normalizedAuctionId = checkedAuctionId(auctionId);
  const stored = await readStoredAuctionConfig(normalizedAuctionId);
  if (stored.found) {
    if (!stored.config) throw new Error("Stored auction config is invalid.");
    return stored.config;
  }
  return normalizedAuctionId === LEGACY_AUCTION_ID
    ? defaultAuctionConfig()
    : null;
}

export async function readAuctionConfig(
  auctionId: string = AUCTION_ID,
): Promise<AuctionConfig> {
  return (await readOptionalAuctionConfig(auctionId)) ?? defaultAuctionConfig();
}

export async function readAuctionRecord(auctionId: string) {
  const normalizedAuctionId = checkedAuctionId(auctionId);
  const raw = await redisCommand<string>([
    "GET",
    auctionRecordKey(normalizedAuctionId),
  ]);

  if (raw) {
    const record = parseStoredAuctionRecord(raw);
    if (record) return record;
  }

  if (normalizedAuctionId !== LEGACY_AUCTION_ID) return null;
  return legacyAuctionRecord(await readAuctionConfig(LEGACY_AUCTION_ID));
}

export async function ensureLegacyAuctionIndexed() {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const config = await readAuctionConfig(LEGACY_AUCTION_ID);
    const record = legacyAuctionRecord(config);
    const startsAtMs = new Date(config.startsAt).getTime();
    const script = `
local activeRaw = redis.call("GET", KEYS[1])
if activeRaw then
  local activeOk, active = pcall(cjson.decode, activeRaw)
  if not activeOk or type(active) ~= "table" or not active.runId then return -1 end
  if active.runId ~= ARGV[1] then return 0 end
elseif ARGV[1] ~= ARGV[2] then
  return 0
end

redis.call("SET", KEYS[2], ARGV[3], "NX")
redis.call("SET", KEYS[3], ARGV[4], "NX")
redis.call("ZADD", KEYS[4], ARGV[5], ARGV[6])
local recordRaw = redis.call("GET", KEYS[2])
local recordOk, currentRecord = pcall(cjson.decode, recordRaw)
if recordOk and type(currentRecord) == "table" and currentRecord.state == "published" then
  redis.call("ZADD", KEYS[5], ARGV[7], ARGV[6])
else
  redis.call("ZREM", KEYS[5], ARGV[6])
end
redis.call("ZADD", KEYS[6], ARGV[7], ARGV[8])
redis.call("ZADD", KEYS[7], ARGV[7], ARGV[9])
return 1
`;

    const result = await redisCommand<number>([
      "EVAL",
      script,
      7,
      auctionConfigKey(LEGACY_AUCTION_ID),
      auctionRecordKey(LEGACY_AUCTION_ID),
      auctionRunConfigKey(config.runId, LEGACY_AUCTION_ID),
      auctionsIndexKey(),
      catalogIndexKey(),
      runsIndexKey(),
      auctionRunsIndexKey(LEGACY_AUCTION_ID),
      config.runId,
      defaultAuctionConfig().runId,
      JSON.stringify(record),
      JSON.stringify(config),
      new Date(record.createdAt).getTime(),
      LEGACY_AUCTION_ID,
      startsAtMs,
      runReference(LEGACY_AUCTION_ID, config.runId),
      config.runId,
    ]);
    if (result === 1) return;
    if (result === -1) throw new Error("Stored legacy auction config is invalid.");
  }

  throw new Error("Legacy auction changed while its catalog index was updated.");
}

export async function listAuctionIds(input: {
  cursor?: string | null;
  limit?: number;
  catalogOnly?: boolean;
}) {
  const limit = input.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) return null;

  if (
    input.cursor === undefined ||
    input.cursor === null ||
    input.cursor === "0"
  ) {
    await ensureLegacyAuctionIndexed();
  }
  const indexKey = input.catalogOnly === false
    ? auctionsIndexKey()
    : catalogIndexKey();
  const page = await listSortedSetPage({
    indexKey,
    purpose:
      input.catalogOnly === false
        ? "auctions.all.v1"
        : "auctions.catalog.v1",
    cursor: input.cursor,
    limit,
  });
  if (!page) return null;
  return {
    auctionIds: page.members,
    nextCursor: page.nextCursor,
  };
}

export async function listAuctionRunIds(input: {
  auctionId: string;
  cursor?: string | null;
  limit?: number;
}) {
  const auctionId = normalizeAuctionId(input.auctionId);
  const cursorPurpose = auctionId ? `auction-runs:${auctionId}` : "";
  const limit = input.limit ?? 20;
  if (
    !auctionId ||
    !parseHistoryCursor(input.cursor, cursorPurpose) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 50
  ) {
    return null;
  }

  if (auctionId === LEGACY_AUCTION_ID) {
    await ensureLegacyAuctionIndexed();
  }

  const page = await readIndexedHistoryPage<AuctionConfig>({
    indexKey: auctionRunsIndexKey(auctionId),
    cursor: input.cursor,
    purpose: cursorPurpose,
    limit,
    normalizeMember: normalizeRunId,
    valueKey: (runId) => auctionRunConfigKey(runId, auctionId),
    parseValue: (raw, runId) => {
      const config = parseStoredAuctionConfig(raw);
      return config?.runId === runId ? config : null;
    },
  });
  if (!page) return null;
  await cleanInvalidRunMembers(auctionId, page.invalidMembers);

  return {
    runIds: page.page.map(({ member }) => member),
    runs: page.page.map(({ member, value: config }) => ({
      runId: member,
      config,
    })),
    nextCursor: page.nextCursor,
  };
}

export async function createAuctionRecord(record: AuctionRecord) {
  const script = `
local created = redis.call("SET", KEYS[1], ARGV[1], "NX")
if not created then return 0 end
redis.call("ZADD", KEYS[2], ARGV[2], ARGV[3])
return 1
`;

  return redisCommand<number>([
    "EVAL",
    script,
    2,
    auctionRecordKey(record.auctionId),
    auctionsIndexKey(),
    JSON.stringify(record),
    new Date(record.createdAt).getTime(),
    record.auctionId,
  ]);
}

export async function createAuctionWithRun(
  record: AuctionRecord,
  config: AuctionConfig,
) {
  const startsAtMs = new Date(config.startsAt).getTime();
  const script = `
if redis.call("EXISTS", KEYS[1]) == 1 then return 0 end
if redis.call("EXISTS", KEYS[3]) == 1 then return -1 end
redis.call("SET", KEYS[1], ARGV[1])
redis.call("SET", KEYS[2], ARGV[2])
redis.call("SET", KEYS[3], ARGV[2])
redis.call("ZADD", KEYS[4], ARGV[3], ARGV[4])
if ARGV[8] == "published" then
  redis.call("ZADD", KEYS[5], ARGV[5], ARGV[4])
end
redis.call("ZADD", KEYS[6], ARGV[5], ARGV[6])
redis.call("ZADD", KEYS[7], ARGV[5], ARGV[7])
redis.call("SET", KEYS[8], 0)
redis.call("SET", KEYS[9], 0)
return 1
`;

  return redisCommand<number>([
    "EVAL",
    script,
    9,
    auctionRecordKey(record.auctionId),
    auctionConfigKey(record.auctionId),
    auctionRunConfigKey(config.runId, record.auctionId),
    auctionsIndexKey(),
    catalogIndexKey(),
    runsIndexKey(),
    auctionRunsIndexKey(record.auctionId),
    runParticipantCountKey(record.auctionId, config.runId),
    runParticipantVersionKey(record.auctionId, config.runId),
    JSON.stringify(record),
    JSON.stringify(config),
    new Date(record.createdAt).getTime(),
    record.auctionId,
    startsAtMs,
    runReference(record.auctionId, config.runId),
    config.runId,
    record.state,
  ]);
}

export async function updateAuctionRecordIfRevision(
  expectedRevision: number,
  record: AuctionRecord,
  currentStartsAtMs: number | null,
) {
  const script = `
local raw = redis.call("GET", KEYS[1])
if not raw then return 0 end
local ok, current = pcall(cjson.decode, raw)
if not ok or type(current) ~= "table" or current.revision ~= tonumber(ARGV[1]) then
  return 0
end
redis.call("SET", KEYS[1], ARGV[2])
if ARGV[3] == "published" and ARGV[4] ~= "" then
  redis.call("ZADD", KEYS[2], ARGV[4], ARGV[5])
else
  redis.call("ZREM", KEYS[2], ARGV[5])
end
return 1
`;

  return redisCommand<number>([
    "EVAL",
    script,
    2,
    auctionRecordKey(record.auctionId),
    catalogIndexKey(),
    expectedRevision,
    JSON.stringify(record),
    record.state,
    currentStartsAtMs ?? "",
    record.auctionId,
  ]);
}

export async function scheduleAuctionRunIfRevision(
  expectedRevision: number,
  record: AuctionRecord,
  config: AuctionConfig,
) {
  const startsAtMs = new Date(config.startsAt).getTime();
  const script = `
local raw = redis.call("GET", KEYS[1])
if not raw then return 0 end
local ok, current = pcall(cjson.decode, raw)
if not ok or type(current) ~= "table" or current.revision ~= tonumber(ARGV[1]) then
  return 0
end
if redis.call("EXISTS", KEYS[3]) == 1 then return -1 end
redis.call("SET", KEYS[1], ARGV[2])
redis.call("SET", KEYS[2], ARGV[3])
redis.call("SET", KEYS[3], ARGV[3])
redis.call("ZADD", KEYS[4], ARGV[4], ARGV[5])
redis.call("ZADD", KEYS[5], ARGV[4], ARGV[6])
if ARGV[7] == "published" then
  redis.call("ZADD", KEYS[6], ARGV[4], ARGV[8])
else
  redis.call("ZREM", KEYS[6], ARGV[8])
end
redis.call("SET", KEYS[7], 0)
redis.call("SET", KEYS[8], 0)
return 1
`;

  return redisCommand<number>([
    "EVAL",
    script,
    8,
    auctionRecordKey(record.auctionId),
    auctionConfigKey(record.auctionId),
    auctionRunConfigKey(config.runId, record.auctionId),
    runsIndexKey(),
    auctionRunsIndexKey(record.auctionId),
    catalogIndexKey(),
    runParticipantCountKey(record.auctionId, config.runId),
    runParticipantVersionKey(record.auctionId, config.runId),
    expectedRevision,
    JSON.stringify(record),
    JSON.stringify(config),
    startsAtMs,
    runReference(record.auctionId, config.runId),
    config.runId,
    record.state,
    record.auctionId,
  ]);
}

export async function writeAuctionConfigIfCurrent(
  expectedRunId: string,
  config: AuctionConfig,
  auctionId: string = AUCTION_ID,
) {
  const normalizedAuctionId = checkedAuctionId(auctionId);
  const serialized = JSON.stringify(config);
  const script = `
local raw = redis.call("GET", KEYS[1])

if raw then
  local ok, current = pcall(cjson.decode, raw)
  if not ok or type(current) ~= "table" or not current.runId then return -1 end
  if current.runId ~= ARGV[1] then return 0 end
elseif ARGV[1] ~= ARGV[2] or ARGV[5] ~= ARGV[6] then
  return 0
end

if redis.call("EXISTS", KEYS[2]) == 1 then return -1 end

redis.call("SET", KEYS[2], ARGV[3])
redis.call("SET", KEYS[1], ARGV[3])
redis.call("ZADD", KEYS[3], ARGV[4], ARGV[7])
redis.call("ZADD", KEYS[4], ARGV[4], ARGV[8])
redis.call("ZADD", KEYS[5], ARGV[4], ARGV[5])
redis.call("SET", KEYS[7], 0)
redis.call("SET", KEYS[8], 0)

local recordRaw = redis.call("GET", KEYS[6])
if recordRaw then
  local recordOk, record = pcall(cjson.decode, recordRaw)
  local configOk, nextConfig = pcall(cjson.decode, ARGV[3])
  if recordOk and configOk and type(record) == "table" and type(nextConfig) == "table" then
    record.currentRunId = nextConfig.runId
    record.productName = nextConfig.productName
    record.productImageUrl = nextConfig.productImageUrl or cjson.null
    record.regularPrice = nextConfig.regularPrice
    record.startPrice = nextConfig.startPrice
    record.floorPrice = nextConfig.floorPrice
    record.durationMinutes = nextConfig.durationMinutes
    record.state = "published"
    record.updatedAt = nextConfig.startsAt
    record.revision = (tonumber(record.revision) or 0) + 1
    redis.call("SET", KEYS[6], cjson.encode(record))
  end
end
return 1
`;

  return redisCommand<number>([
    "EVAL",
    script,
    8,
    auctionConfigKey(normalizedAuctionId),
    auctionRunConfigKey(config.runId, normalizedAuctionId),
    runsIndexKey(),
    auctionRunsIndexKey(normalizedAuctionId),
    catalogIndexKey(),
    auctionRecordKey(normalizedAuctionId),
    runParticipantCountKey(normalizedAuctionId, config.runId),
    runParticipantVersionKey(normalizedAuctionId, config.runId),
    expectedRunId,
    defaultAuctionConfig().runId,
    serialized,
    new Date(config.startsAt).getTime(),
    normalizedAuctionId,
    LEGACY_AUCTION_ID,
    runReference(normalizedAuctionId, config.runId),
    config.runId,
  ]);
}

export async function readAuctionRunConfig(
  runId: string,
  auctionId: string = AUCTION_ID,
) {
  const normalizedAuctionId = checkedAuctionId(auctionId);
  const normalizedRunId = checkedRunId(runId);
  const raw = await redisCommand<string>([
    "GET",
    auctionRunConfigKey(normalizedRunId, normalizedAuctionId),
  ]);

  if (raw !== null) {
    const config = parseStoredAuctionConfig(raw);
    return config?.runId === normalizedRunId ? config : null;
  }

  const activeConfig = await readOptionalAuctionConfig(normalizedAuctionId);
  if (activeConfig?.runId === normalizedRunId) return activeConfig;

  return null;
}

export async function readAuctionWinner(
  runId: string,
  auctionId: string = AUCTION_ID,
): Promise<AuctionWinner | null> {
  const raw = await redisCommand<string>([
    "GET",
    winnerKey(runId, auctionId),
  ]);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as AuctionWinner;
  } catch {
    return null;
  }
}

export async function claimAuctionWinner(
  runId: string,
  winner: AuctionWinner,
  auctionId: string = AUCTION_ID,
) {
  return redisCommand<string>([
    "SET",
    winnerKey(runId, auctionId),
    JSON.stringify(winner),
    "NX",
    "EX",
    604800,
  ]);
}

export async function claimAuctionWinnerIfCurrent(
  runId: string,
  bidderId: string,
  startsAtMs: number,
  endsAtMs: number,
  nowMs: number,
  winner: AuctionWinner,
  auctionId: string = AUCTION_ID,
) {
  const script = `
local configRaw = redis.call("GET", KEYS[1])
if not configRaw then return -3 end
local configOk, config = pcall(cjson.decode, configRaw)
if not configOk or type(config) ~= "table" or not config.runId then return -3 end
if config.runId ~= ARGV[1] then return -1 end
if tonumber(ARGV[3]) < tonumber(ARGV[4]) or tonumber(ARGV[3]) >= tonumber(ARGV[5]) then
  return -1
end
if redis.call("EXISTS", KEYS[2]) ~= 1 then return -2 end
if redis.call("EXISTS", KEYS[3]) == 1 then return 0 end
local created = redis.call("SET", KEYS[3], ARGV[6], "NX", "EX", 604800)
if created then return 1 end
return 0
`;

  return redisCommand<number>([
    "EVAL",
    script,
    3,
    auctionConfigKey(auctionId),
    entryKey(runId, bidderId, auctionId),
    winnerKey(runId, auctionId),
    runId,
    bidderId,
    nowMs,
    startsAtMs,
    endsAtMs,
    JSON.stringify(winner),
  ]);
}

export async function attachAuctionWinnerCheckout(
  runId: string,
  bidderId: string,
  paymentSessionId: string,
  paymentCheckoutUrl: string,
  paymentExpiresAt: string,
  auctionId: string = AUCTION_ID,
  claimedAt?: string,
  paymentProvider: PaymentProviderName = "stripe",
) {
  const normalizedProvider = normalizePaymentProvider(paymentProvider);
  if (!normalizedProvider) throw new Error("Invalid payment provider.");
  const script = `
local raw = redis.call("GET", KEYS[1])
if not raw then return 0 end
local data = cjson.decode(raw)
if data.bidderId ~= ARGV[1] then return 0 end
if data.paymentStatus ~= "pending" then return 0 end
if ARGV[5] ~= "" and data.claimedAt ~= ARGV[5] then return -1 end
data.paymentSessionId = ARGV[2]
data.paymentProvider = ARGV[6]
data.paymentReference = ARGV[2]
data.paymentCheckoutUrl = ARGV[3]
data.paymentExpiresAt = ARGV[4]
redis.call("SET", KEYS[1], cjson.encode(data), "EX", 604800)
return 1
`;

  return redisCommand<number>([
    "EVAL",
    script,
    1,
    winnerKey(runId, auctionId),
    bidderId,
    paymentSessionId,
    paymentCheckoutUrl,
    paymentExpiresAt,
    claimedAt ?? "",
    normalizedProvider,
  ]);
}

export async function markAuctionWinnerPaid(
  runId: string,
  bidderId: string,
  paymentSessionId: string,
  paidAt: string,
  auctionId: string = AUCTION_ID,
) {
  const script = `
local raw = redis.call("GET", KEYS[1])
if not raw then return 0 end
local data = cjson.decode(raw)
if data.bidderId ~= ARGV[1] then return 0 end
if data.paymentStatus ~= "pending" then return 0 end
if data.paymentSessionId ~= ARGV[2] then return 0 end
data.paymentStatus = "paid"
data.paidAt = ARGV[3]
redis.call("SET", KEYS[1], cjson.encode(data), "EX", 604800)
return 1
`;

  return redisCommand<number>([
    "EVAL",
    script,
    1,
    winnerKey(runId, auctionId),
    bidderId,
    paymentSessionId,
    paidAt,
  ]);
}

export async function releaseAuctionWinner(
  runId: string,
  bidderId: string,
  paymentSessionId?: string,
  auctionId: string = AUCTION_ID,
  claimedAt?: string,
) {
  const script = `
local raw = redis.call("GET", KEYS[1])
if not raw then return 0 end
local data = cjson.decode(raw)
if data.bidderId ~= ARGV[1] then return 0 end
if data.paymentStatus == "paid" then return 0 end
if ARGV[2] ~= "" and data.paymentSessionId ~= ARGV[2] then return 0 end
if ARGV[3] ~= "" and data.claimedAt ~= ARGV[3] then return 0 end
redis.call("DEL", KEYS[1])
return 1
`;

  return redisCommand<number>([
    "EVAL",
    script,
    1,
    winnerKey(runId, auctionId),
    bidderId,
    paymentSessionId ?? "",
    claimedAt ?? "",
  ]);
}

export async function readAuctionEntry(
  runId: string,
  bidderId: string,
  auctionId: string = AUCTION_ID,
): Promise<AuctionEntry | null> {
  const raw = await redisCommand<string>([
    "GET",
    entryKey(runId, bidderId, auctionId),
  ]);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as AuctionEntry;
  } catch {
    return null;
  }
}

export async function readParticipant(
  participantIdValue: string,
  auctionIdValue: string,
  runIdValue: string,
): Promise<ParticipantRunRecord | null> {
  const participantId = normalizeParticipantId(participantIdValue);
  const auctionId = normalizeAuctionId(auctionIdValue);
  const runId = normalizeRunId(runIdValue);
  if (!participantId || !auctionId || !runId) return null;

  const raw = await redisCommand<string>([
    "GET",
    participantRunKey(participantId, auctionId, runId),
  ]);
  if (!raw) return null;

  try {
    const participant = normalizeParticipantRunRecord(
      JSON.parse(raw) as unknown,
    );
    if (
      !participant ||
      participant.participantId !== participantId ||
      participant.auctionId !== auctionId ||
      participant.runId !== runId
    ) {
      return null;
    }
    return participant;
  } catch {
    return null;
  }
}

export async function listRunParticipants(input: {
  auctionId: string;
  runId: string;
  cursor?: string | null;
  limit?: number;
}) {
  const auctionId = normalizeAuctionId(input.auctionId);
  const runId = normalizeRunId(input.runId);
  const cursorPurpose =
    auctionId && runId ? `run-participants:${auctionId}:${runId}` : "";
  const limit = input.limit ?? 20;
  if (
    !auctionId ||
    !runId ||
    !parseHistoryCursor(input.cursor, cursorPurpose) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 50
  ) {
    return null;
  }

  let [total] = await ensureRunParticipantCounts([runId], auctionId);
  const page = await readIndexedHistoryPage<ParticipantRunRecord>({
    indexKey: runParticipantsIndexKey(auctionId, runId),
    cursor: input.cursor,
    purpose: cursorPurpose,
    limit,
    normalizeMember: normalizeParticipantId,
    valueKey: (participantId) =>
      participantRunKey(participantId, auctionId, runId),
    parseValue: (raw, participantId) => {
      if (typeof raw !== "string" || !raw) return null;
      try {
        const participant = normalizeParticipantRunRecord(
          JSON.parse(raw) as unknown,
        );
        return participant?.participantId === participantId &&
          participant.auctionId === auctionId &&
          participant.runId === runId
          ? participant
          : null;
      } catch {
        return null;
      }
    },
  });
  if (!page) return null;
  if (page.invalidMembers.length > 0) {
    const cleanedCount = await cleanInvalidParticipantMembers(
      auctionId,
      runId,
      page.invalidMembers,
    );
    total = cleanedCount ?? (await ensureRunParticipantCounts([runId], auctionId))[0];
  }

  return {
    participantIds: page.page.map(({ member }) => member),
    participants: page.page.map(({ value }) => value),
    total,
    nextCursor: page.nextCursor,
  };
}

export async function readAuctionRunHistoryOutcomes(
  runIdValues: string[],
  auctionIdValue: string,
): Promise<AuctionRunHistoryOutcome[]> {
  const auctionId = checkedAuctionId(auctionIdValue);
  const runIds = runIdValues.map(checkedRunId);
  if (runIds.length === 0) return [];
  if (runIds.length > 50 || new Set(runIds).size !== runIds.length) {
    throw new Error("Invalid auction run history outcome batch.");
  }

  const keys = runIds.flatMap((runId) => [
    winnerKey(runId, auctionId),
    auctionRunOrderKey(auctionId, runId),
  ]);
  const stored = await redisCommand<Array<string | null>>(["MGET", ...keys]);
  const values = stored ?? [];
  if (values.length !== keys.length) {
    throw new Error("Stored auction run history outcomes are invalid.");
  }

  return runIds.map((runId, index) => ({
    runId,
    winner: parseStoredAuctionWinner(values[index * 2]),
    order: parseStoredHistoryOrder(values[index * 2 + 1], auctionId, runId),
  }));
}

export async function readAuctionRunHistoryDetails(
  runIdValues: string[],
  auctionIdValue: string,
): Promise<AuctionRunHistoryDetail[]> {
  const auctionId = checkedAuctionId(auctionIdValue);
  const runIds = runIdValues.map(checkedRunId);
  if (runIds.length === 0) return [];
  if (runIds.length > 50 || new Set(runIds).size !== runIds.length) {
    throw new Error("Invalid auction run history batch.");
  }

  const [outcomes, participantCounts] = await Promise.all([
    readAuctionRunHistoryOutcomes(runIds, auctionId),
    ensureRunParticipantCounts(runIds, auctionId),
  ]);
  return outcomes.map((outcome, index) => {
    const participantCount = participantCounts[index];
    if (participantCount === undefined) {
      throw new Error("Auction participant count is missing.");
    }
    return { ...outcome, participantCount };
  });
}

export async function grantAuctionEntryIfCurrent(
  runId: string,
  endsAtMs: number,
  nowMs: number,
  entry: AuctionEntry,
  auctionId: string = AUCTION_ID,
) {
  const normalizedAuctionId = checkedAuctionId(auctionId);
  const normalizedRunId = checkedRunId(runId);
  const participantId = normalizeParticipantId(entry.bidderId);
  if (!participantId) throw new Error("Invalid auction participant id.");
  const canonicalEntry: AuctionEntry = { ...entry, bidderId: participantId };
  const participant: ParticipantRunRecord = {
    schemaVersion: 1,
    participantId,
    auctionId: normalizedAuctionId,
    runId: normalizedRunId,
    entryStatus: "granted",
    entryFee: entry.fee,
    ...(entry.provider ? { entryPaymentProvider: entry.provider } : {}),
    ...(entry.paymentReference || entry.paymentSessionId
      ? {
          entryPaymentReference:
            entry.paymentReference ?? entry.paymentSessionId,
        }
      : {}),
    entryPaymentSessionId: entry.paymentSessionId ?? "",
    grantedAt: entry.grantedAt,
  };
  const normalizedParticipant = normalizeParticipantRunRecord(participant);
  if (!normalizedParticipant) {
    throw new Error("Invalid auction participant record.");
  }
  const historyScore = new Date(entry.grantedAt).getTime();
  if (!Number.isFinite(historyScore)) {
    throw new Error("Invalid auction entry grantedAt.");
  }
  const script = `
local function accountForParticipant(added)
  if added ~= 1 then return end
  redis.call("INCR", KEYS[8])
  if redis.call("EXISTS", KEYS[7]) == 1 then
    redis.call("INCR", KEYS[7])
  end
end

local existingRaw = redis.call("GET", KEYS[2])
if existingRaw then
  local ok, existing = pcall(cjson.decode, existingRaw)
  if not ok or type(existing) ~= "table" then return -3 end
  local existingSessionId = existing.paymentSessionId or ""
  if existingSessionId == ARGV[2] then
    if existing.bidderId ~= ARGV[9] or type(existing.fee) ~= "number" or existing.fee < 0 then return -3 end
    if type(existing.grantedAt) ~= "string" or existing.grantedAt == "" then return -3 end

    local repaired = {
      schemaVersion = 1,
      participantId = ARGV[9],
      auctionId = ARGV[10],
      runId = ARGV[1],
      entryStatus = "granted",
      entryFee = existing.fee,
      entryPaymentProvider = existing.provider or (existingSessionId ~= "" and "stripe" or nil),
      entryPaymentReference = existing.paymentReference or (existingSessionId ~= "" and existingSessionId or nil),
      entryPaymentSessionId = existingSessionId,
      grantedAt = existing.grantedAt
    }
    redis.call("SET", KEYS[4], cjson.encode(repaired), "NX")

    local participantRaw = redis.call("GET", KEYS[4])
    local participantOk, storedParticipant = pcall(cjson.decode, participantRaw or "")
    if not participantOk or type(storedParticipant) ~= "table" then return -3 end
    if storedParticipant.schemaVersion ~= 1 or storedParticipant.participantId ~= ARGV[9] then return -3 end
    if storedParticipant.auctionId ~= ARGV[10] or storedParticipant.runId ~= ARGV[1] then return -3 end
    if storedParticipant.entryStatus ~= "granted" or storedParticipant.entryPaymentSessionId ~= existingSessionId then return -3 end
    if type(storedParticipant.entryFee) ~= "number" or storedParticipant.entryFee < 0 then return -3 end
    if storedParticipant.grantedAt ~= existing.grantedAt then return -3 end

    redis.call("ZADD", KEYS[5], "NX", ARGV[7], ARGV[8])
    local participantAdded = redis.call("ZADD", KEYS[6], "NX", ARGV[7], ARGV[9])
    accountForParticipant(participantAdded)
    return 2
  end
  return -2
end

local configRaw = redis.call("GET", KEYS[1])
if not configRaw then return -3 end

local ok, current = pcall(cjson.decode, configRaw)
if not ok or type(current) ~= "table" or not current.runId then return -3 end
if current.runId ~= ARGV[1] then return 0 end
if redis.call("EXISTS", KEYS[3]) == 1 then return -4 end
if tonumber(ARGV[3]) >= tonumber(ARGV[4]) then return -1 end

redis.call("SET", KEYS[2], ARGV[5], "EX", 604800)
redis.call("SET", KEYS[4], ARGV[6])
redis.call("ZADD", KEYS[5], ARGV[7], ARGV[8])
local participantAdded = redis.call("ZADD", KEYS[6], "NX", ARGV[7], ARGV[9])
accountForParticipant(participantAdded)
return 1
`;

  return redisCommand<number>([
    "EVAL",
    script,
    8,
    auctionConfigKey(normalizedAuctionId),
    entryKey(normalizedRunId, participantId, normalizedAuctionId),
    winnerKey(normalizedRunId, normalizedAuctionId),
    participantRunKey(participantId, normalizedAuctionId, normalizedRunId),
    participantHistoryIndexKey(participantId),
    runParticipantsIndexKey(normalizedAuctionId, normalizedRunId),
    runParticipantCountKey(normalizedAuctionId, normalizedRunId),
    runParticipantVersionKey(normalizedAuctionId, normalizedRunId),
    normalizedRunId,
    entry.paymentSessionId ?? "",
    nowMs,
    endsAtMs,
    JSON.stringify(canonicalEntry),
    JSON.stringify(normalizedParticipant),
    historyScore,
    runReference(normalizedAuctionId, normalizedRunId),
    participantId,
    normalizedAuctionId,
  ]);
}

export async function recordRefundedAuctionEntry(
  record: ParticipantRunRecord,
) {
  const normalizedRecord = normalizeParticipantRunRecord(record);
  if (
    !normalizedRecord ||
    normalizedRecord.participantId !== record.participantId ||
    normalizedRecord.auctionId !== record.auctionId ||
    normalizedRecord.runId !== record.runId
  ) {
    throw new Error("Invalid refunded auction participant record.");
  }
  const score = normalizedRecord.refundedAt
    ? new Date(normalizedRecord.refundedAt).getTime()
    : Date.now();
  const script = `
local function accountForParticipant(added)
  if added ~= 1 then return end
  redis.call("INCR", KEYS[5])
  if redis.call("EXISTS", KEYS[4]) == 1 then
    redis.call("INCR", KEYS[4])
  end
end

local existingRaw = redis.call("GET", KEYS[1])
if existingRaw then
  local ok, existing = pcall(cjson.decode, existingRaw)
  if not ok or type(existing) ~= "table" then return -1 end
  if existing.entryStatus == "granted" or existing.entryStatus == "refunded" then
    return 0
  end
  return -1
end

redis.call("SET", KEYS[1], ARGV[1])
redis.call("ZADD", KEYS[2], ARGV[2], ARGV[3])
local participantAdded = redis.call("ZADD", KEYS[3], "NX", ARGV[2], ARGV[4])
accountForParticipant(participantAdded)
return 1
`;

  return redisCommand<number>([
    "EVAL",
    script,
    5,
    participantRunKey(
      normalizedRecord.participantId,
      normalizedRecord.auctionId,
      normalizedRecord.runId,
    ),
    participantHistoryIndexKey(normalizedRecord.participantId),
    runParticipantsIndexKey(normalizedRecord.auctionId, normalizedRecord.runId),
    runParticipantCountKey(normalizedRecord.auctionId, normalizedRecord.runId),
    runParticipantVersionKey(normalizedRecord.auctionId, normalizedRecord.runId),
    JSON.stringify(normalizedRecord),
    score,
    runReference(normalizedRecord.auctionId, normalizedRecord.runId),
    normalizedRecord.participantId,
  ]);
}
