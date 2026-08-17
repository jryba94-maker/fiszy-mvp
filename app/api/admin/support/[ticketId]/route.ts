import { NextRequest, NextResponse } from "next/server";
import {
  hasAdminPermission,
  isAdminConfigured,
  isSameOriginAdminMutation,
} from "../../../../../lib/admin-auth";
import { recordSuccessfulAdminAudit } from "../../../../../lib/admin-audit";
import { readSupportTicket, updateSupportTicket } from "../../../../../lib/portal-storage";
import { logEvent } from "../../../../../lib/observability";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ ticketId: string }> },
) {
  if (!isAdminConfigured()) return NextResponse.json({ outcome: "admin_not_configured" }, { status: 503 });
  if (!hasAdminPermission(request, "support:write")) return NextResponse.json({ outcome: "forbidden" }, { status: 403 });
  if (!isSameOriginAdminMutation(request)) return NextResponse.json({ outcome: "invalid_origin" }, { status: 403 });
  const { ticketId } = await context.params;
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ outcome: "invalid_request" }, { status: 400 }); }
  const candidate = body && typeof body === "object" ? body as Record<string, unknown> : null;
  const expectedRevision = candidate?.expectedRevision;
  const status = candidate?.status;
  const adminNote = candidate?.adminNote;
  if (!Number.isInteger(expectedRevision) || !["open", "in_progress", "resolved"].includes(String(status)) || (adminNote !== null && typeof adminNote !== "string")) {
    return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
  }
  try {
    const previous = await readSupportTicket(ticketId);
    if (!previous) return NextResponse.json({ outcome: "not_found" }, { status: 404 });
    const ticket = await updateSupportTicket({
      ticketId,
      expectedRevision: Number(expectedRevision),
      status: status as "open" | "in_progress" | "resolved",
      adminNote,
    });
    if (!ticket) return NextResponse.json({ outcome: "revision_conflict" }, { status: 409 });
    await recordSuccessfulAdminAudit(request, {
      action: "support.ticket.updated",
      resourceType: "support_ticket",
      resourceId: ticketId,
      details: {
        previousStatus: previous.status,
        status: ticket.status,
        responseChanged: previous.adminNote !== ticket.adminNote,
        revision: ticket.revision,
      },
    });
    logEvent("admin_support_ticket_updated", { ticketId, status: ticket.status });
    return NextResponse.json({ outcome: "ok", ticket });
  } catch (error) {
    console.error("Unable to update support ticket.", error);
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}
