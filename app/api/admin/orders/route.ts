import { NextRequest, NextResponse } from "next/server";
import { readAuctionConfig } from "../../../../lib/auction-storage";
import {
  ensureAuctionOrderIndexed,
  readAuctionOrder,
  readRecentAuctionOrders,
} from "../../../../lib/order-storage";

export const dynamic = "force-dynamic";

function hasValidAdminKey(request: NextRequest) {
  const configuredKey = process.env.FISZY_ADMIN_SECRET;
  if (!configuredKey) return false;

  const authorization = request.headers.get("authorization") ?? "";
  return authorization === `Bearer ${configuredKey}`;
}

export async function GET(request: NextRequest) {
  if (!process.env.FISZY_ADMIN_SECRET) {
    return NextResponse.json(
      { outcome: "admin_not_configured" },
      { status: 503 },
    );
  }

  if (!hasValidAdminKey(request)) {
    return NextResponse.json({ outcome: "unauthorized" }, { status: 401 });
  }

  try {
    // Backfill the currently visible order once so an order created before
    // the history index rollout is not lost after the next auction starts.
    const config = await readAuctionConfig();
    const currentOrder = await readAuctionOrder(config.runId);
    if (currentOrder) {
      await ensureAuctionOrderIndexed(currentOrder);
    }

    const orders = await readRecentAuctionOrders(50);

    return NextResponse.json({
      outcome: "ok",
      orders,
    });
  } catch (error) {
    console.error("Unable to read auction order history from Redis.", error);
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}
