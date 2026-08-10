import { NextRequest, NextResponse } from "next/server";
import { AUCTION_ID } from "../../../../lib/auction";
import {
  grantAuctionEntry,
  markAuctionWinnerPaid,
  readAuctionWinner,
  releaseAuctionWinner,
  type AuctionEntry,
} from "../../../../lib/auction-storage";
import {
  saveAuctionOrder,
  type AuctionOrder,
  type OrderAddress,
} from "../../../../lib/order-storage";
import {
  stripeWebhookSecret,
  verifyStripeWebhook,
  type StripeAddress,
  type StripeCheckoutSession,
} from "../../../../lib/stripe";

export const dynamic = "force-dynamic";

const ENTRY_FEE = 5;
const ENTRY_FEE_GROSZE = ENTRY_FEE * 100;

function auctionMetadata(session: StripeCheckoutSession, kind: string) {
  const metadata = session.metadata;

  if (
    !metadata ||
    metadata.kind !== kind ||
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

function paidAuctionEntry(session: StripeCheckoutSession) {
  const metadata = auctionMetadata(session, "auction_entry");

  if (
    !metadata ||
    session.mode !== "payment" ||
    session.payment_status !== "paid" ||
    session.amount_total !== ENTRY_FEE_GROSZE ||
    session.currency !== "pln"
  ) {
    return null;
  }

  return metadata;
}

function orderAddress(address: StripeAddress | null | undefined): OrderAddress | null {
  if (!address) return null;

  return {
    city: address.city ?? null,
    country: address.country ?? null,
    line1: address.line1 ?? null,
    line2: address.line2 ?? null,
    postalCode: address.postal_code ?? null,
    state: address.state ?? null,
  };
}

async function handlePaidPurchase(session: StripeCheckoutSession) {
  const metadata = auctionMetadata(session, "auction_purchase");
  if (!metadata || session.mode !== "payment" || session.payment_status !== "paid") {
    return false;
  }

  const winner = await readAuctionWinner(metadata.runId);

  if (
    !winner ||
    winner.bidderId !== metadata.bidderId ||
    winner.paymentSessionId !== session.id ||
    (winner.paymentStatus !== "pending" && winner.paymentStatus !== "paid") ||
    session.currency !== "pln" ||
    session.amount_total !== winner.price * 100
  ) {
    return false;
  }

  const paidAt = winner.paidAt ?? new Date().toISOString();
  const shipping = session.collected_information?.shipping_details ?? null;
  const customer = session.customer_details ?? null;

  const order: AuctionOrder = {
    orderId: `FISZY-${metadata.runId.slice(0, 8).toUpperCase()}`,
    auctionId: AUCTION_ID,
    runId: metadata.runId,
    bidderId: metadata.bidderId,
    product: "AirPods Pro",
    amount: winner.price,
    currency: "pln",
    paymentSessionId: session.id,
    paidAt,
    customer: {
      name:
        shipping?.name ??
        session.collected_information?.individual_name ??
        customer?.individual_name ??
        customer?.name ??
        null,
      email: customer?.email ?? null,
      phone: customer?.phone ?? null,
    },
    shippingAddress: orderAddress(shipping?.address ?? customer?.address),
  };

  await saveAuctionOrder(order);

  if (winner.paymentStatus === "paid") {
    return true;
  }

  const updated = await markAuctionWinnerPaid(
    metadata.runId,
    metadata.bidderId,
    session.id,
    paidAt,
  );

  return updated === 1;
}

async function handleExpiredPurchase(session: StripeCheckoutSession) {
  const metadata = auctionMetadata(session, "auction_purchase");
  if (!metadata) return false;

  const released = await releaseAuctionWinner(
    metadata.runId,
    metadata.bidderId,
    session.id,
  );

  return released === 1;
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

  if (event.type === "checkout.session.expired") {
    try {
      const released = await handleExpiredPurchase(event.data.object);
      return NextResponse.json({ received: true, released });
    } catch (error) {
      console.error("Unable to release expired auction purchase.", error);
      return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
    }
  }

  if (
    event.type !== "checkout.session.completed" &&
    event.type !== "checkout.session.async_payment_succeeded"
  ) {
    return NextResponse.json({ received: true });
  }

  try {
    const paidEntry = paidAuctionEntry(event.data.object);

    if (paidEntry) {
      const entry: AuctionEntry = {
        bidderId: paidEntry.bidderId,
        fee: ENTRY_FEE,
        grantedAt: new Date().toISOString(),
        provider: "stripe",
        paymentSessionId: event.data.object.id,
      };

      await grantAuctionEntry(paidEntry.runId, entry);
      return NextResponse.json({ received: true, kind: "auction_entry" });
    }

    const purchasePaid = await handlePaidPurchase(event.data.object);
    return NextResponse.json({
      received: true,
      kind: purchasePaid ? "auction_purchase" : "ignored",
    });
  } catch (error) {
    console.error("Unable to process Stripe Checkout event.", error);
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}
