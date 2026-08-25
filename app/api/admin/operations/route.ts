import { NextRequest, NextResponse } from "next/server";
import { hasAdminPermission, isAdminConfigured, isSameOriginAdminMutation } from "../../../../lib/admin-auth";
import { recordSuccessfulAdminAudit } from "../../../../lib/admin-audit";
import { reconcileAuctionLifecycleBatch } from "../../../../lib/auction-lifecycle";
import { listOutboxMessages, processMessageOutbox } from "../../../../lib/message-outbox";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isAdminConfigured()) return NextResponse.json({ outcome: "admin_not_configured" }, { status: 503 });
  if (!hasAdminPermission(request, "audit:read")) return NextResponse.json({ outcome: "forbidden" }, { status: 403 });
  try {
    const outbox = await listOutboxMessages({ cursor: request.nextUrl.searchParams.get("cursor"), limit: 30 });
    if (!outbox) return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
    return NextResponse.json({ outcome: "ok", outbox }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Unable to read operations state.", error);
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  if (!isAdminConfigured()) return NextResponse.json({ outcome: "admin_not_configured" }, { status: 503 });
  if (!hasAdminPermission(request, "audit:read")) return NextResponse.json({ outcome: "forbidden" }, { status: 403 });
  if (!isSameOriginAdminMutation(request)) return NextResponse.json({ outcome: "invalid_origin" }, { status: 403 });
  try {
    const [lifecycle, messages] = await Promise.all([
      reconcileAuctionLifecycleBatch({ limit: 50 }),
      processMessageOutbox({ limit: 30 }),
    ]);
    if (!lifecycle || !messages) return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
    const auditEventId = await recordSuccessfulAdminAudit(request, {
      action: "operations.reconciled",
      resourceType: "operations_run",
      resourceId: new Date().toISOString(),
      details: {
        processed: lifecycle.processed + messages.processed,
        changed: lifecycle.changed + messages.delivered,
        errors: lifecycle.errors + messages.errors,
      },
    });
    return NextResponse.json({ outcome: "completed", lifecycle, messages, auditEventId });
  } catch (error) {
    console.error("Unable to reconcile operations.", error);
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}
