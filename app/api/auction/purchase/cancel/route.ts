import { NextRequest, NextResponse } from "next/server";
import {
  readAuctionConfig,
  readAuctionWinner,
  releaseAuctionWinner,
} from "../../../../../lib/auction-storage";
import { expireCheckoutSession } from "../../../../../lib/stripe";

export const dynamic = "force-dynamic";

type CancelRequest = {
  bidderId?: string;
};

export async function POST(request: NextRequest) {
  let body: CancelRequest;

  try {
    body = (await request.json()) as CancelRequest;
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
    const winner = await readAuctionWinner(config.runId);

    if (!winner || winner.bidderId !== bidderId) {
      return NextResponse.json({ outcome: "nothing_to_cancel" });
    }

    if (winner.paymentStatus !== "pending") {
      return NextResponse.json({ outcome: "already_paid" }, { status: 409 });
    }

    if (!winner.paymentSessionId) {
      const released = await releaseAuctionWinner(config.runId, bidderId);
      return NextResponse.json({
        outcome: released === 1 ? "cancelled" : "nothing_to_cancel",
      });
    }

    try {
      await expireCheckoutSession(winner.paymentSessionId);
    } catch (error) {
      console.error("Unable to expire cancelled winner Checkout Session.", error);
      return NextResponse.json({ outcome: "cannot_cancel" }, { status: 409 });
    }

    const released = await releaseAuctionWinner(
      config.runId,
      bidderId,
      winner.paymentSessionId,
    );

    return NextResponse.json({
      outcome: released === 1 ? "cancelled" : "nothing_to_cancel",
    });
  } catch (error) {
    console.error("Unable to cancel winner payment.", error);
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}
