import {
  AUCTION_ID,
  type AuctionConfig,
  defaultAuctionConfig,
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

export function winnerKey(runId: string) {
  return `fiszy:${environmentName()}:auction:${AUCTION_ID}:run:${runId}:winner`;
}

export function entryKey(runId: string, bidderId: string) {
  return `fiszy:${environmentName()}:auction:${AUCTION_ID}:run:${runId}:entry:${encodeURIComponent(bidderId)}`;
}

function isAuctionConfig(value: unknown): value is AuctionConfig {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Partial<AuctionConfig>;
  return (
    typeof candidate.runId === "string" &&
    candidate.runId.length > 0 &&
    candidate.runId.length <= 120 &&
    typeof candidate.startsAt === "string" &&
    Number.isFinite(new Date(candidate.startsAt).getTime())
  );
}

export async function readAuctionConfig(): Promise<AuctionConfig> {
  const raw = await redisCommand<string>(["GET", configKey()]);
  if (!raw) return defaultAuctionConfig();

  try {
    const parsed = JSON.parse(raw) as unknown;
    return isAuctionConfig(parsed) ? parsed : defaultAuctionConfig();
  } catch {
    return defaultAuctionConfig();
  }
}

export async function writeAuctionConfig(config: AuctionConfig) {
  await redisCommand<string>(["SET", configKey(), JSON.stringify(config)]);
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

export async function grantAuctionEntry(runId: string, entry: AuctionEntry) {
  return redisCommand<string>([
    "SET",
    entryKey(runId, entry.bidderId),
    JSON.stringify(entry),
    "EX",
    604800,
  ]);
}
