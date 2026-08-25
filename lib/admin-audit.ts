import type { NextRequest } from "next/server";
import { resolveAdminPrincipal } from "./admin-auth";
import {
  type AuditAction,
  type AuditDetails,
  appendAuditEvent,
  createAuditEvent,
} from "./audit-storage";
import { errorDetails, logEvent } from "./observability";

export async function recordSuccessfulAdminAudit(
  request: NextRequest,
  input: {
    action: AuditAction;
    resourceType:
      | "auction"
      | "order"
      | "account"
      | "support_ticket"
      | "product"
      | "service_case"
      | "privacy_request"
      | "outbox_message"
      | "operations_run";
    resourceId: string;
    details: AuditDetails;
  },
) {
  const principal = await resolveAdminPrincipal(request);
  if (!principal) return null;

  try {
    const event = createAuditEvent({
      actorType: principal.actorType,
      actorRef: principal.actorRef,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      outcome: "success",
      details: input.details,
    });
    const stored = await appendAuditEvent(event);
    if (stored !== 1) {
      logEvent(
        "admin_audit_write_conflict",
        {
          action: input.action,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
        },
        "error",
      );
      return null;
    }
    return event.eventId;
  } catch (caught) {
    logEvent(
      "admin_audit_write_failed",
      {
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        ...errorDetails(caught),
      },
      "error",
    );
    return null;
  }
}
