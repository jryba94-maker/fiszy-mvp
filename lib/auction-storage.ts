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
import { redisCommand } from "./redis";

export type AuctionWinner = {
  bidderId: string;
  price: number;
  claimedAt: string;
  paymentStatus?: "pending" | "paid";
  paymentSessionId?: string;
  paymentCheckoutUrl?: string;
  paymentExpiresAt?: string;
  paidAt?: string;
};

export type AuctionEntry = {
  bidderId: string;
  fee: number;
  grantedAt: string;
  provider?: "test" | "stripe";
  paymentSessionId?: string;
};

export type ParticipantRunRecord = {
  schemaVersion: 1;
  participantId: string;
  auctionId: string;
  runId: string;
  entryStatus: "granted" | "refunded";
  entryFee: number;
  entryPaymentSessionId: string;
  grantedAt?: string;
  refundedAt?: string;
};

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
  const cursor = input.cursor ?? "0";
  if (!/^\d+$/.test(cursor)) return null;

  const offset = Number(cursor);
  const limit = input.limit ?? 20;
  if (!Number.isSafeInteger(offset) || limit < 1 || limit > 50) return null;

  await ensureLegacyAuctionIndexed();
  const indexKey = input.catalogOnly === false
    ? auctionsIndexKey()
    : catalogIndexKey();
  const [ids, total] = await Promise.all([
    redisCommand<string[]>([
      "ZREVRANGE",
      indexKey,
      offset,
      offset + limit - 1,
    ]),
    redisCommand<number>(["ZCARD", indexKey]),
  ]);

  const auctionIds = ids ?? [];
  const nextOffset = offset + auctionIds.length;
  return {
    auctionIds,
    nextCursor: nextOffset < (total ?? 0) ? String(nextOffset) : null,
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
return 1
`;

  return redisCommand<number>([
    "EVAL",
    script,
    7,
    auctionRecordKey(record.auctionId),
    auctionConfigKey(record.auctionId),
    auctionRunConfigKey(config.runId, record.auctionId),
    auctionsIndexKey(),
    catalogIndexKey(),
    runsIndexKey(),
    auctionRunsIndexKey(record.auctionId),
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
return 1
`;

  return redisCommand<number>([
    "EVAL",
    script,
    6,
    auctionRecordKey(record.auctionId),
    auctionConfigKey(record.auctionId),
    auctionRunConfigKey(config.runId, record.auctionId),
    runsIndexKey(),
    auctionRunsIndexKey(record.auctionId),
    catalogIndexKey(),
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
    6,
    auctionConfigKey(normalizedAuctionId),
    auctionRunConfigKey(config.runId, normalizedAuctionId),
    runsIndexKey(),
    auctionRunsIndexKey(normalizedAuctionId),
    catalogIndexKey(),
    auctionRecordKey(normalizedAuctionId),
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

  if (normalizedAuctionId === LEGACY_AUCTION_ID) {
    return { ...defaultAuctionConfig(), runId: normalizedRunId };
  }

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
) {
  const script = `
local raw = redis.call("GET", KEYS[1])
if not raw then return 0 end
local data = cjson.decode(raw)
if data.bidderId ~= ARGV[1] then return 0 end
if data.paymentStatus ~= "pending" then return 0 end
if ARGV[5] ~= "" and data.claimedAt ~= ARGV[5] then return -1 end
data.paymentSessionId = ARGV[2]
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

export async function grantAuctionEntryIfCurrent(
  runId: string,
  endsAtMs: number,
  nowMs: number,
  entry: AuctionEntry,
  auctionId: string = AUCTION_ID,
) {
  const normalizedAuctionId = checkedAuctionId(auctionId);
  const participant: ParticipantRunRecord = {
    schemaVersion: 1,
    participantId: entry.bidderId,
    auctionId: normalizedAuctionId,
    runId,
    entryStatus: "granted",
    entryFee: entry.fee,
    entryPaymentSessionId: entry.paymentSessionId ?? "",
    grantedAt: entry.grantedAt,
  };
  const historyScore = new Date(entry.grantedAt).getTime();
  const script = `
local existingRaw = redis.call("GET", KEYS[2])
if existingRaw then
  local ok, existing = pcall(cjson.decode, existingRaw)
  if not ok or type(existing) ~= "table" then return -3 end
  if existing.paymentSessionId == ARGV[2] then return 2 end
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
redis.call("ZADD", KEYS[6], ARGV[7], ARGV[9])
return 1
`;

  return redisCommand<number>([
    "EVAL",
    script,
    6,
    auctionConfigKey(normalizedAuctionId),
    entryKey(runId, entry.bidderId, normalizedAuctionId),
    winnerKey(runId, normalizedAuctionId),
    participantRunKey(entry.bidderId, normalizedAuctionId, runId),
    participantHistoryIndexKey(entry.bidderId),
    runParticipantsIndexKey(normalizedAuctionId, runId),
    runId,
    entry.paymentSessionId ?? "",
    nowMs,
    endsAtMs,
    JSON.stringify(entry),
    JSON.stringify(participant),
    historyScore,
    runReference(normalizedAuctionId, runId),
    entry.bidderId,
  ]);
}

export async function recordRefundedAuctionEntry(
  record: ParticipantRunRecord,
) {
  const score = record.refundedAt
    ? new Date(record.refundedAt).getTime()
    : Date.now();
  const script = `
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
redis.call("ZADD", KEYS[3], ARGV[2], ARGV[4])
return 1
`;

  return redisCommand<number>([
    "EVAL",
    script,
    3,
    participantRunKey(record.participantId, record.auctionId, record.runId),
    participantHistoryIndexKey(record.participantId),
    runParticipantsIndexKey(record.auctionId, record.runId),
    JSON.stringify(record),
    score,
    runReference(record.auctionId, record.runId),
    record.participantId,
  ]);
}
