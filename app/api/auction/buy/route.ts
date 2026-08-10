import { NextRequest, NextResponse } from "next/server";
import { AUCTION_ID, getTimedAuctionState } from "../../../../lib/auction";
import {
  claimAuctionWinner,
  readAuctionConfig,
  readAuctionWinner,
  type AuctionWinner,
} from "../../../../lib/auction-storage";

export const dynamic = "force-dynamic";

type BuyRequest = {
  bidderId?: string;
};

export async function POST(request: NextRequest) {
  let body: BuyRequest;

  try {
    body = (await request.json()) as BuyRequest;
  } catch {
    return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
  }

  const bidderId = body.bidderId?.trim();

  if (!bidderId || bidderId.length > 100) {
    return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
  }

  try {
    const config = await readAuctionConfig();
    const now = Date.now();
    const auction = getTimedAuctionState(now, config.startsAt);

    if (auction.status !== "live") {
      return NextResponse.json(
        {
          outcome: "not_live",
          status: auction.status,
          currentPrice: auction.currentPrice,
        },
        { status: 409 },
      );
    }

    const winner: AuctionWinner = {
      bidderId,
      price: auction.currentPrice,
      claimedAt: new Date(now).toISOString(),
    };

    const result = await claimAuctionWinner(config.runId, winner);

    if (result === "OK") {
      return NextResponse.json({
        outcome: "won",
        auctionId: AUCTION_ID,
        runId: config.runId,
        price: winner.price,
        claimedAt: winner.claimedAt,
      });
    }

    const existingWinner = await readAuctionWinner(config.runId);

    return NextResponse.json(
      {
        outcome: "lost",
        auctionId: AUCTION_ID,
        runId: config.runId,
        winnerPrice: existingWinner?.price ?? null,
      },
      { status: 409 },
    );
  } catch (error) {
    console.error("Unable to claim auction in Redis.", error);
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}
