import { NextRequest, NextResponse } from "next/server";
import { currentAccountIdentity } from "../../../../lib/account-auth";
import { listParticipantHistory } from "../../../../lib/auction-storage";
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
    const orders = page.items.flatMap((item) => item.order ? [item.order] : []);
    const fulfillments = await readOrderFulfillments(orders);
    const fulfillmentByOrder = new Map(
      orders.map((order, index) => [order.orderId, fulfillmentResponse(fulfillments[index])]),
    );
    const activity = page.items.map(({ participant, config, winner, order }) => ({
      auctionId: participant.auctionId,
      runId: participant.runId,
      product: config.productName,
      productImageUrl: config.productImageUrl,
      startsAt: config.startsAt,
      entryStatus: participant.entryStatus,
      entryFee: participant.entryFee,
      enteredAt: participant.grantedAt ?? participant.refundedAt ?? config.startsAt,
      outcome: order
        ? "won_paid"
        : winner?.bidderId === identity.participantId
          ? "won_payment_pending"
          : winner
            ? "lost"
            : "participating",
      winnerPrice: winner?.bidderId === identity.participantId ? winner.price : null,
      order: order ? {
        orderId: order.orderId,
        amount: order.amount,
        currency: order.currency,
        paidAt: order.paidAt,
        fulfillment: fulfillmentByOrder.get(order.orderId) ?? null,
      } : null,
    }));
    return NextResponse.json(
      { outcome: "ok", activity, nextCursor: page.nextCursor },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  } catch (error) {
    console.error("Unable to read account auction history.", error);
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}
