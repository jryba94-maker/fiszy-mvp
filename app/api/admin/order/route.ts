import { NextRequest, NextResponse } from "next/server";
import { readAuctionConfig } from "../../../../lib/auction-storage";
import {
  readAuctionOrder,
  readLatestAuctionOrder,
  saveAuctionOrder,
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
    let order = await readLatestAuctionOrder();

    if (!order) {
      const config = await readAuctionConfig();
      order = await readAuctionOrder(config.runId);
      if (order) await saveAuctionOrder(order);
    }

    return NextResponse.json({
      outcome: "ok",
      runId: order?.runId ?? null,
      order,
    });
  } catch (error) {
    console.error("Unable to read auction order from Redis.", error);
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}
