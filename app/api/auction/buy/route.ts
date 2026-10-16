import { NextRequest } from "next/server";
import { LEGACY_AUCTION_ID } from "../../../../lib/auction";
import { handleBuyPost } from "../../auctions/_shared/operations";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export function POST(request: NextRequest) {
  return handleBuyPost(request, LEGACY_AUCTION_ID);
}
