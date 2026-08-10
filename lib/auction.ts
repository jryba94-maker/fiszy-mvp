export const AUCTION_ID = "demo-airpods-pro-1";
export const START_PRICE = 749;
export const FLOOR_PRICE = 699;
export const DROP_INTERVAL_MS = 2000;
export const DEFAULT_AUCTION_RUN_ID = "run-2026-08-10-1010";
export const DEFAULT_AUCTION_STARTS_AT = new Date("2026-08-10T08:10:00.000Z");

const TOTAL_DROPS = START_PRICE - FLOOR_PRICE;
export const AUCTION_DURATION_MS = TOTAL_DROPS * DROP_INTERVAL_MS;

export type AuctionConfig = {
  runId: string;
  startsAt: string;
};

export type TimedAuctionStatus = "waiting" | "live" | "ended";

export type TimedAuctionState = {
  currentPrice: number;
  status: TimedAuctionStatus;
};

export function defaultAuctionConfig(): AuctionConfig {
  return {
    runId: DEFAULT_AUCTION_RUN_ID,
    startsAt: DEFAULT_AUCTION_STARTS_AT.toISOString(),
  };
}

export function getAuctionEndsAt(startsAt: string | Date) {
  const start = typeof startsAt === "string" ? new Date(startsAt) : startsAt;
  return new Date(start.getTime() + AUCTION_DURATION_MS);
}

export function getTimedAuctionState(
  now: number = Date.now(),
  startsAt: string | Date = DEFAULT_AUCTION_STARTS_AT,
): TimedAuctionState {
  const start = typeof startsAt === "string" ? new Date(startsAt) : startsAt;
  const startMs = start.getTime();
  const endMs = startMs + AUCTION_DURATION_MS;

  if (!Number.isFinite(startMs)) {
    return { status: "ended", currentPrice: FLOOR_PRICE };
  }

  if (now < startMs) {
    return { status: "waiting", currentPrice: START_PRICE };
  }

  if (now >= endMs) {
    return { status: "ended", currentPrice: FLOOR_PRICE };
  }

  const completedDrops = Math.floor((now - startMs) / DROP_INTERVAL_MS);

  return {
    status: "live",
    currentPrice: Math.max(FLOOR_PRICE, START_PRICE - completedDrops),
  };
}
