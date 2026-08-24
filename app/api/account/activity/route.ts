import { NextRequest, NextResponse } from "next/server";
import { currentAccountIdentity } from "../../../../lib/account-auth";
import { listParticipantHistory } from "../../../../lib/auction-storage";
import { getTimedAuctionState } from "../../../../lib/auction";
import {
  issuePostAuctionDiscount,
  preparePostAuctionDiscount,
} from "../../../../lib/discount-storage";
import {
  fulfillmentResponse,
  readOrderFulfillments,
} from "../../../../lib/fulfillment-storage";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const identity = await currentAccountIdentity();
  if (!identity) return NextResponse.json({ outcome: "unauthorized" }, { status: 401 });
  const cursor = request.nextUrl.searchParams.get("cursor");
  const limitValue = request.nextUrl.searchParams.get("limit");
  const limit = limitValue === null ? 20 : Number(limitValue);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || (cursor?.length ?? 0) > 1024) {
    return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
  }
  try {
    const page = await listParticipantHistory({
      participantId: identity.participantId,
      cursor,
      limit,
    });
    if (!page) return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
    const enrichedItems = await Promise.all(page.items.map(async (item) => {
      const preparedDiscount = preparePostAuctionDiscount({
        accountId: identity.accountId,
        participant: item.participant,
        config: item.config,
        winner: item.winner,
        order: item.order,
      });
      const discount = preparedDiscount
        ? await issuePostAuctionDiscount(preparedDiscount)
        : null;
      return { ...item, discount };
    }));
    const orders = enrichedItems.flatMap((item) =>
      item.order?.bidderId === identity.participantId ? [item.order] : [],
    );
    const fulfillments = await readOrderFulfillments(orders);
    const fulfillmentByOrder = new Map(
      orders.map((order, index) => [order.orderId, fulfillmentResponse(fulfillments[index])]),
    );
    const now = Date.now();
    const activity = enrichedItems.map(({ participant, config, winner, order, discount }) => {
      const accountOrder = order?.bidderId === identity.participantId ? order : null;
      const runSettled = Boolean(winner && order?.bidderId === winner.bidderId);
      return {
        auctionId: participant.auctionId,
        runId: participant.runId,
        product: config.productName,
        productImageUrl: config.productImageUrl,
        startsAt: config.startsAt,
        entryStatus: participant.entryStatus,
        entryFee: participant.entryFee,
        enteredAt: participant.grantedAt ?? participant.refundedAt ?? config.startsAt,
        outcome: accountOrder
          ? "won_paid"
          : winner?.bidderId === identity.participantId
            ? "won_payment_pending"
            : runSettled
              ? "lost"
              : getTimedAuctionState(now, config).status === "ended"
                ? "lost"
                : "participating",
        winnerPrice: winner?.bidderId === identity.participantId ? winner.price : null,
        order: accountOrder ? {
          orderId: accountOrder.orderId,
          amount: accountOrder.amount,
          currency: accountOrder.currency,
          paidAt: accountOrder.paidAt,
          fulfillment: fulfillmentByOrder.get(accountOrder.orderId) ?? null,
        } : null,
        discount: discount ? {
          discountId: discount.discountId,
          product: discount.product,
          productImageUrl: discount.productImageUrl,
          regularPrice: discount.regularPrice,
          discountAmount: discount.discountAmount,
          finalPrice: discount.finalPrice,
          currency: discount.currency,
          issuedAt: discount.issuedAt,
          expiresAt: discount.expiresAt,
          state:
            (discount.state === "available" || discount.state === "reserved") &&
            now >= Date.parse(discount.expiresAt)
              ? "expired"
              : discount.state,
          orderId: discount.orderId ?? null,
        } : null,
      };
    });
    return NextResponse.json(
      { outcome: "ok", activity, nextCursor: page.nextCursor },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  } catch (error) {
    console.error("Unable to read account auction history.", error);
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}
