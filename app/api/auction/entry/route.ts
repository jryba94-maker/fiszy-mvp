import { NextRequest } from "next/server";
import { LEGACY_AUCTION_ID } from "../../../../lib/auction";
import {
  handleEntryGet,
  handleEntryPost,
} from "../../auctions/_shared/operations";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  return handleEntryGet(request, LEGACY_AUCTION_ID);
}

export function POST(request: NextRequest) {
  return handleEntryPost(request, LEGACY_AUCTION_ID);
}
