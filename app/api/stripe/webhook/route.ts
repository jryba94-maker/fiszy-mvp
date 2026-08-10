import { NextRequest, NextResponse } from "next/server";
import { AUCTION_ID, getAuctionEndsAt } from "../../../../lib/auction";
import {
  grantAuctionEntryIfCurrent,
  markAuctionWinnerPaid,
  readAuctionRunConfig,
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
  refundCheckoutSessionPayment,
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

async function handlePaidEntry(session: StripeCheckoutSession) {
  const paidEntry = paidAuctionEntry(session);
  if (!paidEntry) return null;

  const runConfig = await readAuctionRunConfig(paidEntry.runId);
  const now = Date.now();
  const entry: AuctionEntry = {
    bidderId: paidEntry.bidderId,
    fee: ENTRY_FEE,
    grantedAt: new Date(now).toISOString(),
    provider: "stripe",
    paymentSessionId: session.id,
  };

  const grantResult = await grantAuctionEntryIfCurrent(
    paidEntry.runId,
    getAuctionEndsAt(runConfig).getTime(),
    now,
    entry,
  );

  if (grantResult === 1 || grantResult === 2) {
    return "auction_entry";
  }

  if (
    grantResult === 0 ||
    grantResult === -1 ||
    grantResult === -2 ||
    grantResult === -4
  ) {
    await refundCheckoutSessionPayment(session);
    return "auction_entry_refunded";
  }

  throw new Error("Unable to validate paid auction entry state.");
}

async function handlePaidPurchase(session: StripeCheckoutSession) {
  const metadata = auctionMetadata(session, "auction_purchase");
  if (!metadata || session.mode !== "payment" || session.payment_status !== "paid") {
    return false;
  }

  const [winner, runConfig] = await Promise.all([
    readAuctionWinner(metadata.runId),
    readAuctionRunConfig(metadata.runId),
  ]);

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
    product: runConfig.productName,
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
    const entryOutcome = await handlePaidEntry(event.data.object);
    if (entryOutcome) {
      return NextResponse.json({ received: true, kind: entryOutcome });
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
