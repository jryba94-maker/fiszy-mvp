import { NextRequest, NextResponse } from "next/server";
import { currentAccountIdentity } from "../../../../../../lib/account-auth";
import {
  attachDiscountPaymentSession,
  readPostAuctionDiscount,
  releasePostAuctionDiscount,
  reservePostAuctionDiscount,
} from "../../../../../../lib/discount-storage";
import {
  configuredPaymentProvider,
  createDiscountPurchasePaymentSession,
  expirePaymentSession,
  isPaymentProviderConfigured,
} from "../../../../../../lib/payment-provider";
import { consumeAccountRateLimit } from "../../../../../../lib/portal-storage";
import {
  getCheckoutOrigin,
  hasSameOrigin,
} from "../../../../../../lib/request-origin";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ discountId: string }> },
) {
  const identity = await currentAccountIdentity();
  if (!identity) {
    return NextResponse.json({ outcome: "unauthorized" }, { status: 401 });
  }
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ outcome: "invalid_origin" }, { status: 403 });
  }
  if (!isPaymentProviderConfigured()) {
    return NextResponse.json(
      { outcome: "payment_not_configured" },
      { status: 503 },
    );
  }
  try {
    const allowed = await consumeAccountRateLimit({
      accountId: identity.accountId,
      action: "discounts",
      limit: 20,
      windowSeconds: 600,
    });
    if (!allowed) {
      return NextResponse.json(
        { outcome: "rate_limited" },
        { status: 429, headers: { "Retry-After": "600" } },
      );
    }
  } catch {
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }

  const { discountId } = await context.params;
  try {
    const reservation = await reservePostAuctionDiscount({
      discountId,
      accountId: identity.accountId,
    });
    if (reservation.outcome === "expired") {
      return NextResponse.json({ outcome: "discount_expired" }, { status: 409 });
    }
    if (reservation.outcome === "sold_out") {
      return NextResponse.json({ outcome: "sold_out" }, { status: 409 });
    }
    if (reservation.outcome === "unavailable") {
      return NextResponse.json({ outcome: "discount_unavailable" }, { status: 409 });
    }
    if (!("discount" in reservation)) {
      return NextResponse.json({ outcome: "discount_unavailable" }, { status: 409 });
    }
    const discount = reservation.discount;
    if (discount.paymentCheckoutUrl && discount.paymentReference) {
      return NextResponse.json({
        outcome: "checkout",
        checkoutUrl: discount.paymentCheckoutUrl,
      });
    }
    if (!discount.reservationToken || !discount.reservationExpiresAt) {
      throw new Error("Discount reservation is incomplete.");
    }

    let session;
    try {
      session = await createDiscountPurchasePaymentSession({
        origin: getCheckoutOrigin(request),
        auctionId: discount.auctionId,
        runId: discount.runId,
        bidderId: discount.participantId,
        accountId: discount.accountId,
        discountId: discount.discountId,
        reservationToken: discount.reservationToken,
        amount: discount.finalPrice * 100,
        expiresAt: Math.floor(Date.parse(discount.reservationExpiresAt) / 1000),
        productName: discount.product,
      });
    } catch (error) {
      await releasePostAuctionDiscount({
        discountId: discount.discountId,
        accountId: discount.accountId,
        reservationToken: discount.reservationToken,
      });
      throw error;
    }

    const attached = await attachDiscountPaymentSession({
      discountId: discount.discountId,
      accountId: discount.accountId,
      reservationToken: discount.reservationToken,
      provider: configuredPaymentProvider(),
      reference: session.reference,
      checkoutUrl: session.checkoutUrl as string,
    });
    if (attached !== 1) {
      try {
        await expirePaymentSession(session.reference);
      } finally {
        await releasePostAuctionDiscount({
          discountId: discount.discountId,
          accountId: discount.accountId,
          reservationToken: discount.reservationToken,
        });
      }
      return NextResponse.json({ outcome: "discount_unavailable" }, { status: 409 });
    }

    return NextResponse.json({ outcome: "checkout", checkoutUrl: session.checkoutUrl });
  } catch (error) {
    console.error("Unable to create discounted purchase Checkout Session.", error);
    const stored = await readPostAuctionDiscount(discountId).catch(() => null);
    if (stored?.accountId !== identity.accountId) {
      return NextResponse.json({ outcome: "discount_not_found" }, { status: 404 });
    }
    return NextResponse.json({ outcome: "payment_error" }, { status: 503 });
  }
}
