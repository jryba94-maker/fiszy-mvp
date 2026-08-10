import { NextRequest, NextResponse } from "next/server";
import { AUCTION_ID } from "../../../../lib/auction";
import {
  grantAuctionEntry,
  type AuctionEntry,
} from "../../../../lib/auction-storage";
import {
  stripeWebhookSecret,
  verifyStripeWebhook,
  type StripeCheckoutSession,
} from "../../../../lib/stripe";

export const dynamic = "force-dynamic";

const ENTRY_FEE = 5;
const ENTRY_FEE_GROSZE = ENTRY_FEE * 100;

function paidAuctionEntry(session: StripeCheckoutSession) {
  const metadata = session.metadata;

  if (
    session.mode !== "payment" ||
    session.payment_status !== "paid" ||
    session.amount_total !== ENTRY_FEE_GROSZE ||
    session.currency !== "pln" ||
    !metadata ||
    metadata.kind !== "auction_entry" ||
    metadata.auctionId !== AUCTION_ID ||
    !metadata.runId ||
    !metadata.bidderId ||
    metadata.runId.length > 120 ||
    metadata.bidderId.length > 100
  ) {
    return null;
  }

  return {
    runId: metadata.runId,
    bidderId: metadata.bidderId,
  };
}

export async function POST(request: NextRequest) {
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ outcome: "webhook_not_configured" }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ outcome: "missing_signature" }, { status: 400 });
  }

  const rawBody = await request.text();

  let event;
  try {
    event = verifyStripeWebhook(rawBody, signature, stripeWebhookSecret());
  } catch (error) {
    console.error("Stripe webhook signature verification failed.", error);
    return NextResponse.json({ outcome: "invalid_signature" }, { status: 400 });
  }

  if (
    event.type !== "checkout.session.completed" &&
    event.type !== "checkout.session.async_payment_succeeded"
  ) {
    return NextResponse.json({ received: true });
  }

  const paidEntry = paidAuctionEntry(event.data.object);
  if (!paidEntry) {
    return NextResponse.json({ received: true, ignored: true });
  }

  const entry: AuctionEntry = {
    bidderId: paidEntry.bidderId,
    fee: ENTRY_FEE,
    grantedAt: new Date().toISOString(),
    provider: "stripe",
    paymentSessionId: event.data.object.id,
  };

  try {
    await grantAuctionEntry(paidEntry.runId, entry);
  } catch (error) {
    console.error("Unable to grant paid auction entry in Redis.", error);
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }

  return NextResponse.json({ received: true });
}
