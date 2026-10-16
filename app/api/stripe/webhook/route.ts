import { NextRequest, NextResponse } from "next/server";
import { stripeWebhookSecret, verifyStripeWebhook } from "../../../../lib/stripe";
import { errorDetails, logEvent } from "../../../../lib/observability";
import { handlePaidEntry, handlePaidPurchase, handlePaidDiscountPurchase, handleExpiredPurchase, handleExpiredDiscountPurchase } from "../../../../lib/checkout-settlement";

export const dynamic = "force-dynamic";

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
      const released =
        (await handleExpiredPurchase(event.data.object)) ||
        (await handleExpiredDiscountPurchase(event.data.object));
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

    const purchasePaid = await handlePaidPurchase(event.data.object, event.created);
    if (purchasePaid) {
      return NextResponse.json({ received: true, kind: "auction_purchase" });
    }
    const discountPaid = await handlePaidDiscountPurchase(event.data.object);
    return NextResponse.json({
      received: true,
      kind: discountPaid ? "post_auction_purchase" : "ignored",
    });
  } catch (error) {
    logEvent("stripe_webhook_processing_failed", errorDetails(error), "error");
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}
