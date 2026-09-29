import { NextRequest, NextResponse } from "next/server";
import {
  hasAdminPermission,
  isAdminConfigured,
  isSameOriginAdminMutation,
} from "../../../../../lib/admin-auth";
import { recordSuccessfulAdminAudit } from "../../../../../lib/admin-audit";
import {
  deleteWaitlistSignup,
  validWaitlistSubscriberId,
} from "../../../../../lib/waitlist-storage";
import { logEvent } from "../../../../../lib/observability";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ subscriberId: string }> },
) {
  if (!isAdminConfigured()) return NextResponse.json({ outcome: "admin_not_configured" }, { status: 503 });
  if (!hasAdminPermission(request, "users:write")) return NextResponse.json({ outcome: "forbidden" }, { status: 403 });
  if (!isSameOriginAdminMutation(request)) return NextResponse.json({ outcome: "invalid_origin" }, { status: 403 });

  const { subscriberId } = await context.params;
  if (!validWaitlistSubscriberId(subscriberId)) return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });

  try {
    const removed = await deleteWaitlistSignup(subscriberId);
    if (removed === null) return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
    if (!removed) return NextResponse.json({ outcome: "not_found" }, { status: 404 });

    await recordSuccessfulAdminAudit(request, {
      action: "waitlist.signup.deleted",
      resourceType: "waitlist_signup",
      resourceId: subscriberId,
      details: { permanentRemoval: true },
    });
    logEvent("admin_waitlist_signup_deleted", { subscriberId });
    return NextResponse.json({ outcome: "ok" });
  } catch (error) {
    console.error("Unable to delete waitlist signup.", error);
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}
