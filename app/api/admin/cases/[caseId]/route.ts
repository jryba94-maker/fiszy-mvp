import { NextRequest, NextResponse } from "next/server";
import { hasAdminPermission, isAdminConfigured, isSameOriginAdminMutation } from "../../../../../lib/admin-auth";
import { recordSuccessfulAdminAudit } from "../../../../../lib/admin-audit";
import { enqueueTransactionalMessage, processMessageOutbox } from "../../../../../lib/message-outbox";
import { isServiceCaseTransitionAllowed, readServiceCase, SERVICE_CASE_STATUSES, type ServiceCaseStatus, updateServiceCase } from "../../../../../lib/service-case-storage";
import { siteUrl } from "../../../../../lib/site";

export async function PATCH(request: NextRequest, context: { params: Promise<{ caseId: string }> }) {
  if (!isAdminConfigured()) return NextResponse.json({ outcome: "admin_not_configured" }, { status: 503 });
  if (!hasAdminPermission(request, "support:write")) return NextResponse.json({ outcome: "forbidden" }, { status: 403 });
  if (!isSameOriginAdminMutation(request)) return NextResponse.json({ outcome: "invalid_origin" }, { status: 403 });
  const { caseId } = await context.params;
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return NextResponse.json({ outcome: "invalid_request" }, { status: 400 }); }
  if (
    !Number.isInteger(body.expectedRevision) ||
    !SERVICE_CASE_STATUSES.includes(body.status as ServiceCaseStatus) ||
    !["not_applicable", "pending", "completed"].includes(String(body.refundStatus)) ||
    (body.adminResponse !== null && typeof body.adminResponse !== "string") ||
    (body.resolution !== null && typeof body.resolution !== "string")
  ) return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
  const adminResponse = typeof body.adminResponse === "string" ? body.adminResponse.trim() : "";
  const resolution = typeof body.resolution === "string" ? body.resolution.trim() : "";
  if (
    (!["submitted", "reviewing"].includes(String(body.status)) && !adminResponse) ||
    (body.status === "completed" && !resolution)
  ) return NextResponse.json({ outcome: "response_required" }, { status: 400 });
  try {
    const previous = await readServiceCase(caseId);
    if (!previous) return NextResponse.json({ outcome: "not_found" }, { status: 404 });
    if (!isServiceCaseTransitionAllowed(previous.status, body.status as ServiceCaseStatus)) return NextResponse.json({ outcome: "invalid_transition" }, { status: 409 });
    const serviceCase = await updateServiceCase({
      caseId,
      expectedRevision: Number(body.expectedRevision),
      status: body.status as ServiceCaseStatus,
      adminResponse: body.adminResponse as string | null,
      resolution: body.resolution as string | null,
      refundStatus: body.refundStatus as "not_applicable" | "pending" | "completed",
    });
    if (!serviceCase) return NextResponse.json({ outcome: "revision_conflict" }, { status: 409 });
    const auditEventId = await recordSuccessfulAdminAudit(request, {
      action: "service_case.updated",
      resourceType: "service_case",
      resourceId: serviceCase.caseId,
      details: { previousStatus: previous.status, status: serviceCase.status, responseChanged: previous.adminResponse !== serviceCase.adminResponse, revision: serviceCase.revision },
    });
    await enqueueTransactionalMessage({
      dedupeKey: `service_case.${serviceCase.caseId}.${serviceCase.revision}`,
      accountId: serviceCase.accountId,
      recipient: serviceCase.contactEmail,
      template: "service_case_update",
      title: `Aktualizacja zgłoszenia ${serviceCase.caseId}`,
      text: serviceCase.adminResponse ?? `Status zgłoszenia: ${serviceCase.status}.`,
      actionLabel: "Sprawdź zgłoszenie",
      actionUrl: `${siteUrl()}/moje-fiszy#pomoc`,
    });
    await processMessageOutbox({ limit: 10 });
    return NextResponse.json({ outcome: "ok", case: serviceCase, auditEventId });
  } catch (error) {
    console.error("Unable to update service case.", error);
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}
