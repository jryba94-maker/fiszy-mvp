export const AUCTION_ID = "demo-airpods-pro-1";
export const START_PRICE = 749;
export const FLOOR_PRICE = 699;
export const DROP_INTERVAL_MS = 2000;
export const AUCTION_STARTS_AT = new Date("2026-08-10T08:10:00.000Z");

const TOTAL_DROPS = START_PRICE - FLOOR_PRICE;
const AUCTION_DURATION_MS = TOTAL_DROPS * DROP_INTERVAL_MS;
export const AUCTION_ENDS_AT = new Date(AUCTION_STARTS_AT.getTime() + AUCTION_DURATION_MS);

export type TimedAuctionStatus = "waiting" | "live" | "ended";

export type TimedAuctionState = {
  currentPrice: number;
  status: TimedAuctionStatus;
};

export function getTimedAuctionState(now: number = Date.now()): TimedAuctionState {
  const startsAt = AUCTION_STARTS_AT.getTime();
  const endsAt = AUCTION_ENDS_AT.getTime();

  if (now < startsAt) {
    return { status: "waiting", currentPrice: START_PRICE };
  }

  if (now >= endsAt) {
    return { status: "ended", currentPrice: FLOOR_PRICE };
  }

  const completedDrops = Math.floor((now - startsAt) / DROP_INTERVAL_MS);

  return {
    status: "live",
    currentPrice: Math.max(FLOOR_PRICE, START_PRICE - completedDrops),
  };
}
