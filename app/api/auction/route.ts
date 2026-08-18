import { NextResponse } from "next/server";
import {
  AUCTION_ID,
  defaultAuctionConfig,
  getAuctionEndsAt,
  getTimedAuctionState,
} from "../../../lib/auction";
import {
  readAuctionConfig,
  readAuctionRecord,
  readAuctionWinner,
} from "../../../lib/auction-storage";
import { readAuctionOrder } from "../../../lib/order-storage";

export const dynamic = "force-dynamic";

export async function GET() {
  const now = Date.now();
  let config = defaultAuctionConfig();
  let winner = null;
  let order = null;
  let storageReady = true;

  try {
    config = await readAuctionConfig();
    const record = await readAuctionRecord(AUCTION_ID);
    if (record?.state !== "published") {
      return NextResponse.json(
        { outcome: "not_found" },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }
    [winner, order] = await Promise.all([
      readAuctionWinner(config.runId),
      readAuctionOrder(config.runId, AUCTION_ID),
    ]);
  } catch (error) {
    storageReady = false;
    console.error("Unable to read auction state from Redis.", error);
  }

  const timedState = getTimedAuctionState(now, config);
  const status = order
    ? "sold"
    : winner
    ? winner.paymentStatus === "pending"
      ? "payment_pending"
      : "sold"
    : timedState.status;
  const currentPrice = order?.amount ?? winner?.price ?? timedState.currentPrice;

  return NextResponse.json(
    {
      auctionId: AUCTION_ID,
      runId: config.runId,
      product: config.productName,
      productImageUrl: config.productImageUrl,
      regularPrice: config.regularPrice,
      startPrice: config.startPrice,
      floorPrice: config.floorPrice,
      durationMinutes: config.durationMinutes,
      currentPrice,
      entryFee: config.entryFee,
      status,
      startsAt: config.startsAt,
      endsAt: getAuctionEndsAt(config).toISOString(),
      soldAt: order?.paidAt ??
        (winner && winner.paymentStatus !== "pending"
          ? winner.paidAt ?? winner.claimedAt
          : null),
      paymentExpiresAt:
        !order && winner?.paymentStatus === "pending"
          ? winner.paymentExpiresAt ?? null
          : null,
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
