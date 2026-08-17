import type { NextRequest } from "next/server";
import { verifiedAdminActorType } from "./admin-auth";
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
    resourceType: "auction" | "order" | "account" | "support_ticket";
    resourceId: string;
    details: AuditDetails;
  },
) {
  const actorType = verifiedAdminActorType(request);
  if (!actorType) return null;

  try {
    const event = createAuditEvent({
      actorType,
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
