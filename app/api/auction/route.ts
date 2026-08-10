import { NextResponse } from "next/server";
import {
  AUCTION_ID,
  FLOOR_PRICE,
  START_PRICE,
  defaultAuctionConfig,
  getAuctionEndsAt,
  getTimedAuctionState,
} from "../../../lib/auction";
import {
  readAuctionConfig,
  readAuctionWinner,
} from "../../../lib/auction-storage";

export const dynamic = "force-dynamic";

export async function GET() {
  const now = Date.now();
  let config = defaultAuctionConfig();
  let winner = null;
  let storageReady = true;

  try {
    config = await readAuctionConfig();
    winner = await readAuctionWinner(config.runId);
  } catch (error) {
    storageReady = false;
    console.error("Unable to read auction state from Redis.", error);
  }

  const timedState = getTimedAuctionState(now, config.startsAt);
  const status = winner
    ? winner.paymentStatus === "pending"
      ? "payment_pending"
      : "sold"
    : timedState.status;
  const currentPrice = winner?.price ?? timedState.currentPrice;

  return NextResponse.json(
    {
      auctionId: AUCTION_ID,
      runId: config.runId,
      product: "AirPods Pro",
      regularPrice: 999,
      startPrice: START_PRICE,
      floorPrice: FLOOR_PRICE,
      currentPrice,
      entryFee: 5,
      status,
      startsAt: config.startsAt,
      endsAt: getAuctionEndsAt(config.startsAt).toISOString(),
      soldAt:
        winner && winner.paymentStatus !== "pending"
          ? winner.paidAt ?? winner.claimedAt
          : null,
      paymentExpiresAt:
        winner?.paymentStatus === "pending" ? winner.paymentExpiresAt ?? null : null,
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
