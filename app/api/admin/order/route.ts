import { NextRequest, NextResponse } from "next/server";
import { hasValidAdminRequest, isAdminConfigured } from "../../../../lib/admin-auth";
import { LEGACY_AUCTION_ID } from "../../../../lib/auction";
import { readAuctionConfig } from "../../../../lib/auction-storage";
import {
  readAuctionOrder,
  readLatestGlobalAuctionOrder,
  saveAuctionOrder,
} from "../../../../lib/order-storage";

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

  try {
    let order = await readLatestGlobalAuctionOrder();
    if (!order) {
      const config = await readAuctionConfig(LEGACY_AUCTION_ID);
      order = await readAuctionOrder(config.runId, LEGACY_AUCTION_ID);
      if (order) await saveAuctionOrder(order);
    }

    return NextResponse.json(
      { outcome: "ok", runId: order?.runId ?? null, order },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Unable to read latest auction order.", error);
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}
