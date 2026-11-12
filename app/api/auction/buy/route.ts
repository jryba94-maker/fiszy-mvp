import { NextRequest } from "next/server";
import { LEGACY_AUCTION_ID } from "../../../../lib/auction";
import { handleBuyPost } from "../../auctions/_shared/operations";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export function POST(request: NextRequest) {
  const receivedAt = Number(request.headers.get("x-fiszy-buy-received-at")) || Date.now();
  return handleBuyPost(request, LEGACY_AUCTION_ID, receivedAt);
}
