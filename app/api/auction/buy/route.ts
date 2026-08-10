import { NextRequest, NextResponse } from "next/server";
import { AUCTION_ID, getTimedAuctionState } from "../../../../lib/auction";
import {
  attachAuctionWinnerCheckout,
  claimAuctionWinner,
  readAuctionConfig,
  readAuctionEntry,
  readAuctionWinner,
  releaseAuctionWinner,
  type AuctionWinner,
} from "../../../../lib/auction-storage";
import { getCheckoutOrigin } from "../../../../lib/request-origin";
import {
  createPurchaseCheckoutSession,
  expireCheckoutSession,
} from "../../../../lib/stripe";

export const dynamic = "force-dynamic";

const PURCHASE_CHECKOUT_WINDOW_SECONDS = 31 * 60;

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

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ outcome: "stripe_not_configured" }, { status: 503 });
  }

  try {
    const config = await readAuctionConfig();
    const now = Date.now();
    const auction = getTimedAuctionState(now, config);

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

    const entry = await readAuctionEntry(config.runId, bidderId);

    if (!entry) {
      return NextResponse.json(
        {
          outcome: "entry_required",
          auctionId: AUCTION_ID,
          runId: config.runId,
        },
        { status: 403 },
      );
    }

    const winner: AuctionWinner = {
      bidderId,
      price: auction.currentPrice,
      claimedAt: new Date(now).toISOString(),
      paymentStatus: "pending",
    };

    const result = await claimAuctionWinner(config.runId, winner);

    if (result === "OK") {
      const expiresAt = Math.floor(Date.now() / 1000) + PURCHASE_CHECKOUT_WINDOW_SECONDS;
      let session;

      try {
        session = await createPurchaseCheckoutSession({
          origin: getCheckoutOrigin(request),
          auctionId: AUCTION_ID,
          runId: config.runId,
          bidderId,
          amount: winner.price * 100,
          expiresAt,
          productName: config.productName,
        });
      } catch (error) {
        await releaseAuctionWinner(config.runId, bidderId);
        console.error("Unable to create winner Stripe Checkout Session.", error);
        return NextResponse.json({ outcome: "payment_error" }, { status: 503 });
      }

      const attached = await attachAuctionWinnerCheckout(
        config.runId,
        bidderId,
        session.id,
        session.url!,
        new Date(expiresAt * 1000).toISOString(),
      );

      if (attached !== 1) {
        try {
          await expireCheckoutSession(session.id);
        } catch (error) {
          console.error("Unable to expire unattached Stripe Checkout Session.", error);
        }
        await releaseAuctionWinner(config.runId, bidderId);
        return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
      }

      return NextResponse.json({
        outcome: "checkout",
        auctionId: AUCTION_ID,
        runId: config.runId,
        price: winner.price,
        claimedAt: winner.claimedAt,
        checkoutUrl: session.url,
      });
    }

    const existingWinner = await readAuctionWinner(config.runId);

    if (
      existingWinner?.bidderId === bidderId &&
      existingWinner.paymentStatus === "pending" &&
      existingWinner.paymentCheckoutUrl
    ) {
      return NextResponse.json({
        outcome: "checkout",
        auctionId: AUCTION_ID,
        runId: config.runId,
        price: existingWinner.price,
        checkoutUrl: existingWinner.paymentCheckoutUrl,
      });
    }

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
