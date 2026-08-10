import { NextResponse } from "next/server";
import {
  AUCTION_ENDS_AT,
  AUCTION_ID,
  AUCTION_STARTS_AT,
  FLOOR_PRICE,
  START_PRICE,
  getTimedAuctionState,
} from "../../../lib/auction";
import { redisCommand } from "../../../lib/redis";

export const dynamic = "force-dynamic";

type AuctionWinner = {
  bidderId: string;
  price: number;
  claimedAt: string;
};

function winnerKey() {
  const environment = process.env.VERCEL_ENV ?? "local";
  return `fiszy:${environment}:auction:${AUCTION_ID}:winner`;
}

async function readWinner(): Promise<AuctionWinner | null> {
  const value = await redisCommand<string>(["GET", winnerKey()]);
  if (!value) return null;

  try {
    return JSON.parse(value) as AuctionWinner;
  } catch {
    return null;
  }
}

export async function GET() {
  const now = Date.now();
  const timedState = getTimedAuctionState(now);

  let winner: AuctionWinner | null = null;
  let storageReady = true;

  try {
    winner = await readWinner();
  } catch (error) {
    storageReady = false;
    console.error("Unable to read auction winner from Redis.", error);
  }

  const status = winner ? "sold" : timedState.status;
  const currentPrice = winner?.price ?? timedState.currentPrice;

  return NextResponse.json(
    {
      auctionId: AUCTION_ID,
      product: "AirPods Pro",
      regularPrice: 999,
      startPrice: START_PRICE,
      floorPrice: FLOOR_PRICE,
      currentPrice,
      entryFee: 5,
      status,
      startsAt: AUCTION_STARTS_AT.toISOString(),
      endsAt: AUCTION_ENDS_AT.toISOString(),
      soldAt: winner?.claimedAt ?? null,
      storageReady,
      serverTime: new Date(now).toISOString(),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
