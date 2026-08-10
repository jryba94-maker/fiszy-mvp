import { NextRequest, NextResponse } from "next/server";
import { readAuctionConfig } from "../../../../lib/auction-storage";
import { readAuctionOrder } from "../../../../lib/order-storage";

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
    const config = await readAuctionConfig();
    const order = await readAuctionOrder(config.runId);

    return NextResponse.json({
      outcome: "ok",
      runId: config.runId,
      order,
    });
  } catch (error) {
    console.error("Unable to read auction order from Redis.", error);
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}
