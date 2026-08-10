import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  ENTRY_FEE,
  getAuctionEndsAt,
  normalizeAuctionId,
  normalizeRunId,
} from "../../../../lib/auction";
import {
  grantAuctionEntryIfCurrent,
  recordRefundedAuctionEntry,
  readAuctionRunConfig,
  readAuctionWinner,
  releaseAuctionWinner,
  type AuctionEntry,
} from "../../../../lib/auction-storage";
import {
  savePaidAuctionOrder,
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
import { errorDetails, logEvent } from "../../../../lib/observability";

export const dynamic = "force-dynamic";

const ENTRY_FEE_GROSZE = ENTRY_FEE * 100;

function auctionMetadata(session: StripeCheckoutSession, kind: string) {
  const metadata = session.metadata;

  if (
    !metadata ||
    metadata.kind !== kind ||
    !metadata.auctionId ||
    !metadata.runId ||
    !metadata.bidderId ||
    metadata.bidderId.length > 100
  ) {
    return null;
  }

  const auctionId = normalizeAuctionId(metadata.auctionId);
  const runId = normalizeRunId(metadata.runId);
  if (!auctionId || !runId) return null;

  return {
    auctionId,
    runId,
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

  const runConfig = await readAuctionRunConfig(
    paidEntry.runId,
    paidEntry.auctionId,
  );
  const now = Date.now();
  const entry: AuctionEntry = {
    bidderId: paidEntry.bidderId,
    fee: ENTRY_FEE,
    grantedAt: new Date(now).toISOString(),
    provider: "stripe",
    paymentSessionId: session.id,
  };

  const grantResult = runConfig
    ? await grantAuctionEntryIfCurrent(
        paidEntry.runId,
        getAuctionEndsAt(runConfig).getTime(),
        now,
        entry,
        paidEntry.auctionId,
      )
    : 0;

  if (grantResult === 1 || grantResult === 2) {
    logEvent("auction_entry_granted", {
      auctionId: paidEntry.auctionId,
      runId: paidEntry.runId,
      duplicate: grantResult === 2,
    });
    return "auction_entry";
  }

  if (
    grantResult === 0 ||
    grantResult === -1 ||
    grantResult === -2 ||
    grantResult === -4
  ) {
    await refundCheckoutSessionPayment(session);
    await recordRefundedAuctionEntry({
      schemaVersion: 1,
      participantId: paidEntry.bidderId,
      auctionId: paidEntry.auctionId,
      runId: paidEntry.runId,
      entryStatus: "refunded",
      entryFee: ENTRY_FEE,
      entryPaymentSessionId: session.id,
      refundedAt: new Date().toISOString(),
    });
    logEvent("late_auction_entry_refunded", {
      auctionId: paidEntry.auctionId,
      runId: paidEntry.runId,
      grantResult,
    }, "warning");
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
    readAuctionWinner(metadata.runId, metadata.auctionId),
    readAuctionRunConfig(metadata.runId, metadata.auctionId),
  ]);

  if (!runConfig) {
    throw new Error("Paid auction purchase has no immutable run configuration.");
  }

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
    orderId: `FISZY-${createHash("sha256")
      .update(`${metadata.auctionId}\u0000${metadata.runId}`)
      .digest("hex")
      .slice(0, 24)
      .toUpperCase()}`,
    auctionId: metadata.auctionId,
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

  const saved = await savePaidAuctionOrder(order);
  if (saved === 1 || saved === 0) {
    logEvent("auction_purchase_paid", {
      auctionId: metadata.auctionId,
      runId: metadata.runId,
      amount: winner.price,
      duplicate: saved === 0,
    });
    return true;
  }
  if (saved === -2) return false;
  throw new Error("Unable to save paid auction order atomically.");
}

async function handleExpiredPurchase(session: StripeCheckoutSession) {
  const metadata = auctionMetadata(session, "auction_purchase");
  if (!metadata) return false;

  const released = await releaseAuctionWinner(
    metadata.runId,
    metadata.bidderId,
    session.id,
    metadata.auctionId,
  );

  logEvent("auction_purchase_expired", {
    auctionId: metadata.auctionId,
    runId: metadata.runId,
    released: released === 1,
  });

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
    logEvent("stripe_webhook_signature_rejected", errorDetails(error), "warning");
    return NextResponse.json({ outcome: "invalid_signature" }, { status: 400 });
  }

  if (event.type === "checkout.session.expired") {
    try {
      const released = await handleExpiredPurchase(event.data.object);
      return NextResponse.json({ received: true, released });
    } catch (error) {
      logEvent(
        "stripe_webhook_expiry_failed",
        errorDetails(error),
        "error",
      );
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
    logEvent("stripe_webhook_processing_failed", errorDetails(error), "error");
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}
