import { NextRequest, NextResponse } from "next/server";
import { AUCTION_ID, getTimedAuctionState } from "../../../../lib/auction";
import { redisCommand } from "../../../../lib/redis";

export const dynamic = "force-dynamic";

type BuyRequest = {
  bidderId?: string;
};

type AuctionWinner = {
  bidderId: string;
  price: number;
  claimedAt: string;
};

function winnerKey() {
  const environment = process.env.VERCEL_ENV ?? "local";
  return `fiszy:${environment}:auction:${AUCTION_ID}:winner`;
}

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

  const now = Date.now();
  const auction = getTimedAuctionState(now);

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

  try {
    const result = await redisCommand<string>([
      "SET",
      winnerKey(),
      JSON.stringify(winner),
      "NX",
    ]);

    if (result === "OK") {
      return NextResponse.json({
        outcome: "won",
        auctionId: AUCTION_ID,
        price: winner.price,
        claimedAt: winner.claimedAt,
      });
    }

    const existingValue = await redisCommand<string>(["GET", winnerKey()]);
    let winnerPrice: number | null = null;

    if (existingValue) {
      try {
        winnerPrice = (JSON.parse(existingValue) as AuctionWinner).price;
      } catch {
        winnerPrice = null;
      }
    }

    return NextResponse.json(
      {
        outcome: "lost",
        auctionId: AUCTION_ID,
        winnerPrice,
      },
      { status: 409 },
    );
  } catch (error) {
    console.error("Unable to claim auction in Redis.", error);
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}
