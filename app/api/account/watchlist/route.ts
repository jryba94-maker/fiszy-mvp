import { NextRequest, NextResponse } from "next/server";
import { currentAccountIdentity } from "../../../../lib/account-auth";
import { normalizeAuctionId } from "../../../../lib/auction";
import { readAuctionRecord } from "../../../../lib/auction-storage";
import { consumeAccountRateLimit, listWatchedAuctionIds, setAuctionWatched } from "../../../../lib/portal-storage";
import { hasSameOrigin } from "../../../../lib/request-origin";

export const dynamic = "force-dynamic";

export async function GET() {
  const identity = await currentAccountIdentity();
  if (!identity) return NextResponse.json({ outcome: "unauthorized" }, { status: 401 });
  try {
    const auctionIds = await listWatchedAuctionIds(identity.accountId);
    return NextResponse.json(
      { outcome: "ok", auctionIds },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  } catch (error) {
    console.error("Unable to read account watchlist.", error);
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}

export async function PATCH(request: NextRequest) {
  const identity = await currentAccountIdentity();
  if (!identity) return NextResponse.json({ outcome: "unauthorized" }, { status: 401 });
  if (!hasSameOrigin(request)) return NextResponse.json({ outcome: "invalid_origin" }, { status: 403 });
  try {
    if (!(await consumeAccountRateLimit({ accountId: identity.accountId, action: "watchlist", limit: 60, windowSeconds: 600 }))) {
      return NextResponse.json({ outcome: "rate_limited" }, { status: 429, headers: { "Retry-After": "600" } });
    }
  } catch {
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
  }
  const candidate = body && typeof body === "object" ? body as Record<string, unknown> : null;
  const auctionId = normalizeAuctionId(candidate?.auctionId);
  const watched = candidate?.watched;
  if (!auctionId || typeof watched !== "boolean") {
    return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
  }
  try {
    const record = await readAuctionRecord(auctionId);
    if (!record || record.state === "archived") {
      return NextResponse.json({ outcome: "auction_not_found" }, { status: 404 });
    }
    await setAuctionWatched({ accountId: identity.accountId, auctionId, watched });
    return NextResponse.json({ outcome: "ok", auctionId, watched });
  } catch (error) {
    console.error("Unable to update account watchlist.", error);
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}
