import {
  AUCTION_ID,
  type AuctionConfig,
  defaultAuctionConfig,
  defaultAuctionDefinition,
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

function environmentName() {
  return process.env.VERCEL_ENV ?? "local";
}

function configKey() {
  return `fiszy:${environmentName()}:auction:${AUCTION_ID}:config`;
}

function runConfigKey(runId: string) {
  return `fiszy:${environmentName()}:auction:${AUCTION_ID}:run:${runId}:config`;
}

export function winnerKey(runId: string) {
  return `fiszy:${environmentName()}:auction:${AUCTION_ID}:run:${runId}:winner`;
}

export function entryKey(runId: string, bidderId: string) {
  return `fiszy:${environmentName()}:auction:${AUCTION_ID}:run:${runId}:entry:${encodeURIComponent(bidderId)}`;
}

function normalizeAuctionConfig(value: unknown): AuctionConfig | null {
  if (!value || typeof value !== "object") return null;

  const candidate = value as Partial<AuctionConfig>;
  if (
    typeof candidate.runId !== "string" ||
    candidate.runId.length === 0 ||
    candidate.runId.length > 120 ||
    typeof candidate.startsAt !== "string" ||
    !Number.isFinite(new Date(candidate.startsAt).getTime())
  ) {
    return null;
  }

  const defaults = defaultAuctionDefinition();
  const definition =
    parseAuctionDefinition({
      productName: candidate.productName ?? defaults.productName,
      productImageUrl: candidate.productImageUrl ?? defaults.productImageUrl,
      regularPrice: candidate.regularPrice ?? defaults.regularPrice,
      startPrice: candidate.startPrice ?? defaults.startPrice,
      floorPrice: candidate.floorPrice ?? defaults.floorPrice,
      durationMinutes: candidate.durationMinutes ?? defaults.durationMinutes,
    }) ?? defaults;

  return {
    schemaVersion: 2,
    runId: candidate.runId,
    startsAt: candidate.startsAt,
    ...definition,
  };
}

export async function readAuctionConfig(): Promise<AuctionConfig> {
  const raw = await redisCommand<string>(["GET", configKey()]);
  if (!raw) return defaultAuctionConfig();

  try {
    const parsed = JSON.parse(raw) as unknown;
    return normalizeAuctionConfig(parsed) ?? defaultAuctionConfig();
  } catch {
    return defaultAuctionConfig();
  }
}

export async function writeAuctionConfigIfCurrent(
  expectedRunId: string,
  config: AuctionConfig,
) {
  const serialized = JSON.stringify(config);
  const script = `
local raw = redis.call("GET", KEYS[1])

if raw then
  local ok, current = pcall(cjson.decode, raw)
  if not ok or type(current) ~= "table" or not current.runId then return -1 end
  if current.runId ~= ARGV[1] then return 0 end
elseif ARGV[1] ~= ARGV[2] then
  return 0
end

if redis.call("EXISTS", KEYS[2]) == 1 then return -1 end

redis.call("SET", KEYS[2], ARGV[3])
redis.call("SET", KEYS[1], ARGV[3])
return 1
`;

  return redisCommand<number>([
    "EVAL",
    script,
    2,
    configKey(),
    runConfigKey(config.runId),
    expectedRunId,
    defaultAuctionConfig().runId,
    serialized,
  ]);
}

export async function readAuctionRunConfig(runId: string) {
  const raw = await redisCommand<string>(["GET", runConfigKey(runId)]);

  if (raw) {
    try {
      const config = normalizeAuctionConfig(JSON.parse(raw) as unknown);
      if (config?.runId === runId) return config;
    } catch {
      // Fall through to the active or legacy configuration.
    }
  }

  const activeConfig = await readAuctionConfig();
  if (activeConfig.runId === runId) return activeConfig;

  return {
    ...defaultAuctionConfig(),
    runId,
  };
}

export async function readAuctionWinner(runId: string): Promise<AuctionWinner | null> {
  const raw = await redisCommand<string>(["GET", winnerKey(runId)]);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as AuctionWinner;
  } catch {
    return null;
  }
}

export async function claimAuctionWinner(runId: string, winner: AuctionWinner) {
  return redisCommand<string>([
    "SET",
    winnerKey(runId),
    JSON.stringify(winner),
    "NX",
    "EX",
    604800,
  ]);
}

export async function attachAuctionWinnerCheckout(
  runId: string,
  bidderId: string,
  paymentSessionId: string,
  paymentCheckoutUrl: string,
  paymentExpiresAt: string,
) {
  const script = `
local raw = redis.call("GET", KEYS[1])
if not raw then return 0 end
local data = cjson.decode(raw)
if data.bidderId ~= ARGV[1] then return 0 end
if data.paymentStatus ~= "pending" then return 0 end
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
    winnerKey(runId),
    bidderId,
    paymentSessionId,
    paymentCheckoutUrl,
    paymentExpiresAt,
  ]);
}

export async function markAuctionWinnerPaid(
  runId: string,
  bidderId: string,
  paymentSessionId: string,
  paidAt: string,
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
    winnerKey(runId),
    bidderId,
    paymentSessionId,
    paidAt,
  ]);
}

export async function releaseAuctionWinner(
  runId: string,
  bidderId: string,
  paymentSessionId?: string,
) {
  const script = `
local raw = redis.call("GET", KEYS[1])
if not raw then return 0 end
local data = cjson.decode(raw)
if data.bidderId ~= ARGV[1] then return 0 end
if data.paymentStatus == "paid" then return 0 end
if ARGV[2] ~= "" and data.paymentSessionId ~= ARGV[2] then return 0 end
redis.call("DEL", KEYS[1])
return 1
`;

  return redisCommand<number>([
    "EVAL",
    script,
    1,
    winnerKey(runId),
    bidderId,
    paymentSessionId ?? "",
  ]);
}

export async function readAuctionEntry(
  runId: string,
  bidderId: string,
): Promise<AuctionEntry | null> {
  const raw = await redisCommand<string>(["GET", entryKey(runId, bidderId)]);
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
) {
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
return 1
`;

  return redisCommand<number>([
    "EVAL",
    script,
    3,
    configKey(),
    entryKey(runId, entry.bidderId),
    winnerKey(runId),
    runId,
    entry.paymentSessionId ?? "",
    nowMs,
    endsAtMs,
    JSON.stringify(entry),
  ]);
}
