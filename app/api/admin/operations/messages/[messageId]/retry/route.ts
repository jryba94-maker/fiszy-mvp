import { NextRequest, NextResponse } from "next/server";
import { hasAdminPermissionAsync, isAdminConfigured, isSameOriginAdminMutation } from "../../../../../../../lib/admin-auth";
import { recordSuccessfulAdminAudit } from "../../../../../../../lib/admin-audit";
import { retryDeadOutboxMessage } from "../../../../../../../lib/message-outbox";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ messageId: string }> };

export async function POST(request: NextRequest, context: Context) {
  if (!isAdminConfigured()) return NextResponse.json({ outcome: "admin_not_configured" }, { status: 503 });
  if (!(await hasAdminPermissionAsync(request, "support:write"))) return NextResponse.json({ outcome: "forbidden" }, { status: 403 });
  if (!isSameOriginAdminMutation(request)) return NextResponse.json({ outcome: "invalid_origin" }, { status: 403 });
  const { messageId } = await context.params;
  try {
    const result = await retryDeadOutboxMessage(messageId);
    if (!result) return NextResponse.json({ outcome: "not_found" }, { status: 404 });
    if (result.outcome === "conflict") return NextResponse.json({ outcome: "message_not_dead" }, { status: 409 });
    const auditEventId = await recordSuccessfulAdminAudit(request, {
      action: "outbox.message.retried",
      resourceType: "outbox_message",
      resourceId: messageId,
      details: { previousState: "dead" },
    });
    return NextResponse.json({ outcome: "retried", message: result.message, auditEventId });
  } catch (error) {
    console.error(JSON.stringify({ level: "error", message: "outbox_manual_retry_failed", messageId, error: error instanceof Error ? error.message : String(error) }));
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}
