import { NextResponse } from "next/server";
import { normalizeAuctionId } from "../../../../lib/auction";
import { readPublicAuctionForPolling } from "../../../../lib/auction-view";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ auctionId: string }> },
) {
  const started = performance.now();
  const { auctionId: rawAuctionId } = await context.params;
  const auctionId = normalizeAuctionId(rawAuctionId);
  if (!auctionId) {
    return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
  }

  try {
    const auction = await readPublicAuctionForPolling(auctionId);
    if (!auction) {
      return NextResponse.json({ outcome: "not_found" }, { status: 404 });
    }

    return NextResponse.json(
      { outcome: "ok", auction },
      { headers: { "Cache-Control": "no-store", "Server-Timing": `auction;dur=${(performance.now()-started).toFixed(1)}` } },
    );
  } catch (error) {
    console.error("Unable to read auction from Redis.", error);
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}
