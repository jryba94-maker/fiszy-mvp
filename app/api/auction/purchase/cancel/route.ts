import { NextRequest } from "next/server";
import { LEGACY_AUCTION_ID } from "../../../../../lib/auction";
import { handleCancelPost } from "../../../auctions/_shared/operations";

export const dynamic = "force-dynamic";

export function POST(request: NextRequest) {
  return handleCancelPost(request, LEGACY_AUCTION_ID);
}
