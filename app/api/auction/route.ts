import { NextResponse } from "next/server";

const START_PRICE = 749;
const FLOOR_PRICE = 699;
const DROP_INTERVAL_MS = 2000;
const AUCTION_STARTS_AT = new Date("2026-08-10T08:00:00.000Z");
const TOTAL_DROPS = START_PRICE - FLOOR_PRICE;
const AUCTION_DURATION_MS = TOTAL_DROPS * DROP_INTERVAL_MS;
const AUCTION_ENDS_AT = new Date(AUCTION_STARTS_AT.getTime() + AUCTION_DURATION_MS);

export const dynamic = "force-dynamic";

type AuctionStatus = "waiting" | "live" | "ended";

export async function GET() {
  const now = Date.now();
  const startsAt = AUCTION_STARTS_AT.getTime();
  const endsAt = AUCTION_ENDS_AT.getTime();

  let status: AuctionStatus;
  let currentPrice: number;

  if (now < startsAt) {
    status = "waiting";
    currentPrice = START_PRICE;
  } else if (now >= endsAt) {
    status = "ended";
    currentPrice = FLOOR_PRICE;
  } else {
    status = "live";
    const completedDrops = Math.floor((now - startsAt) / DROP_INTERVAL_MS);
    currentPrice = Math.max(FLOOR_PRICE, START_PRICE - completedDrops);
  }

  return NextResponse.json(
    {
      auctionId: "demo-airpods-pro-1",
      product: "AirPods Pro",
      regularPrice: 999,
      startPrice: START_PRICE,
      floorPrice: FLOOR_PRICE,
      currentPrice,
      entryFee: 5,
      status,
      startsAt: AUCTION_STARTS_AT.toISOString(),
      endsAt: AUCTION_ENDS_AT.toISOString(),
      serverTime: new Date(now).toISOString(),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
