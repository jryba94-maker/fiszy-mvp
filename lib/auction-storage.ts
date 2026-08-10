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
