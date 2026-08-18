import { NextRequest, NextResponse } from "next/server";
import { hasValidAdminRequest, isAdminConfigured } from "../../../../lib/admin-auth";
import {
  fulfillmentResponse,
  readOrderFulfillments,
} from "../../../../lib/fulfillment-storage";
import { listAuctionOrders } from "../../../../lib/order-storage";
import { looksLikeSortedSetCursor } from "../../../../lib/sorted-set-pagination";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isAdminConfigured()) {
    return NextResponse.json(
      { outcome: "admin_not_configured" },
      { status: 503 },
    );
  }
  if (!hasValidAdminRequest(request)) {
    return NextResponse.json({ outcome: "unauthorized" }, { status: 401 });
  }

  const cursor = request.nextUrl.searchParams.get("cursor");
  const limitValue = request.nextUrl.searchParams.get("limit");
  const limit = limitValue === null ? 20 : Number(limitValue);
  if (
    (cursor !== null && !looksLikeSortedSetCursor(cursor)) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 50
  ) {
    return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
  }

  try {
    const page = await listAuctionOrders({ cursor, limit });
    if (!page) {
      return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
    }
    const fulfillments = await readOrderFulfillments(page.orders);
    const orders = page.orders.map((order, index) => ({
      ...order,
      fulfillment: fulfillmentResponse(fulfillments[index]),
    }));
    return NextResponse.json(
      { outcome: "ok", ...page, orders },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Unable to list auction orders.", error);
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}
