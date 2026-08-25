import { NextRequest, NextResponse } from "next/server";
import {
  hasAdminPermission,
  hasValidAdminRequest,
  isAdminConfigured,
} from "../../../../lib/admin-auth";
import { listAuditEvents } from "../../../../lib/audit-storage";
import { errorDetails, logEvent } from "../../../../lib/observability";
import { looksLikeSortedSetCursor } from "../../../../lib/sorted-set-pagination";

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
  if (!hasAdminPermission(request, "audit:read")) {
    return NextResponse.json({ outcome: "forbidden" }, { status: 403 });
  }

  const cursor = request.nextUrl.searchParams.get("cursor");
  const limitValue = request.nextUrl.searchParams.get("limit");
  const limit = limitValue === null ? 20 : Number(limitValue);
  const resourceType = request.nextUrl.searchParams.get("resourceType");
  const resourceId = request.nextUrl.searchParams.get("resourceId");
  if (
    (cursor !== null && !looksLikeSortedSetCursor(cursor)) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 50 ||
    Boolean(resourceType) !== Boolean(resourceId)
  ) {
    return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
  }

  try {
    const page = await listAuditEvents({
      cursor,
      limit,
      resourceType,
      resourceId,
    });
    if (!page) {
      return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
    }
    const events = page.events.map((event) => ({
      ...event,
      actor: event.actorRef ? `${event.actorType}:${event.actorRef}` : event.actorType,
    }));
    return NextResponse.json(
      { outcome: "ok", ...page, events },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (caught) {
    logEvent("admin_audit_list_failed", errorDetails(caught), "error");
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}
