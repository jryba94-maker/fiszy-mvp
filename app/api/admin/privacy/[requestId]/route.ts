import { NextRequest, NextResponse } from "next/server";
import { hasAdminPermission, isAdminConfigured, isSameOriginAdminMutation } from "../../../../../lib/admin-auth";
import { recordSuccessfulAdminAudit } from "../../../../../lib/admin-audit";
import { isPrivacyRequestTransitionAllowed, PRIVACY_REQUEST_STATUSES, readPrivacyRequest, type PrivacyRequestStatus, updatePrivacyRequest } from "../../../../../lib/privacy-storage";

export async function PATCH(request: NextRequest, context: { params: Promise<{ requestId: string }> }) {
  if (!isAdminConfigured()) return NextResponse.json({ outcome: "admin_not_configured" }, { status: 503 });
  if (!hasAdminPermission(request, "users:write")) return NextResponse.json({ outcome: "forbidden" }, { status: 403 });
  if (!isSameOriginAdminMutation(request)) return NextResponse.json({ outcome: "invalid_origin" }, { status: 403 });
  const { requestId } = await context.params;
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return NextResponse.json({ outcome: "invalid_request" }, { status: 400 }); }
  if (!Number.isInteger(body.expectedRevision) || !PRIVACY_REQUEST_STATUSES.includes(body.status as PrivacyRequestStatus) || (body.adminNote !== undefined && body.adminNote !== null && typeof body.adminNote !== "string")) return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
  try {
    const previous = await readPrivacyRequest(requestId);
    if (!previous) return NextResponse.json({ outcome: "not_found" }, { status: 404 });
    const nextStatus = body.status as PrivacyRequestStatus;
    const adminNote = typeof body.adminNote === "string" ? body.adminNote.trim() : "";
    if (!isPrivacyRequestTransitionAllowed(previous.status, nextStatus)) return NextResponse.json({ outcome: "invalid_transition" }, { status: 409 });
    if ((nextStatus === "completed" || nextStatus === "rejected") && !adminNote) return NextResponse.json({ outcome: "admin_note_required" }, { status: 400 });
    const privacyRequest = await updatePrivacyRequest({ requestId, expectedRevision: Number(body.expectedRevision), status: nextStatus, adminNote: body.adminNote as string | null | undefined });
    if (!privacyRequest) return NextResponse.json({ outcome: "revision_conflict" }, { status: 409 });
    const auditEventId = await recordSuccessfulAdminAudit(request, {
      action: "privacy.request.updated",
      resourceType: "privacy_request",
      resourceId: requestId,
      details: { previousStatus: previous.status, status: privacyRequest.status, revision: privacyRequest.revision },
    });
    return NextResponse.json({ outcome: "ok", request: privacyRequest, auditEventId });
  } catch (error) {
    console.error("Unable to update privacy request.", error);
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}
