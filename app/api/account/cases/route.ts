import { NextRequest, NextResponse } from "next/server";
import { currentAccountIdentity } from "../../../../lib/account-auth";
import { recordBusinessEventSafely } from "../../../../lib/business-analytics";
import { readAuctionOrderById } from "../../../../lib/order-storage";
import { consumeAccountRateLimit } from "../../../../lib/portal-storage";
import { hasSameOrigin } from "../../../../lib/request-origin";
import { createServiceCase, listAccountServiceCases, normalizeServiceCaseInput } from "../../../../lib/service-case-storage";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const identity = await currentAccountIdentity();
  if (!identity) return NextResponse.json({ outcome: "unauthorized" }, { status: 401 });
  try {
    const page = await listAccountServiceCases({ accountId: identity.accountId, cursor: request.nextUrl.searchParams.get("cursor"), limit: 20 });
    if (!page) return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
    return NextResponse.json({ outcome: "ok", ...page }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Unable to list account service cases.", error);
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const identity = await currentAccountIdentity();
  if (!identity) return NextResponse.json({ outcome: "unauthorized" }, { status: 401 });
  if (!hasSameOrigin(request)) return NextResponse.json({ outcome: "invalid_origin" }, { status: 403 });
  try {
    if (!(await consumeAccountRateLimit({ accountId: identity.accountId, action: "support", limit: 5, windowSeconds: 600 }))) {
      return NextResponse.json({ outcome: "rate_limited" }, { status: 429, headers: { "Retry-After": "600" } });
    }
    const input = normalizeServiceCaseInput(await request.json());
    if (!input) return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
    if (input.orderId) {
      const order = await readAuctionOrderById(input.orderId);
      if (!order || order.bidderId !== identity.participantId) {
        return NextResponse.json({ outcome: "order_not_found" }, { status: 404 });
      }
    }
    const serviceCase = await createServiceCase({ accountId: identity.accountId, ...input });
    await recordBusinessEventSafely({ event: "service_case_created" });
    return NextResponse.json({ outcome: "created", case: serviceCase }, { status: 201 });
  } catch (error) {
    console.error("Unable to create service case.", error);
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}
