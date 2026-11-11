import { NextRequest, NextResponse } from "next/server";
import { hasValidAdminRequest, isAdminConfigured, hasAdminPermission } from "../../../../../lib/admin-auth";
import { autopayOperationalIssues } from "../../../../../lib/autopay-storage";
import { errorDetails, logEvent } from "../../../../../lib/observability";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isAdminConfigured()) return NextResponse.json({ outcome: "admin_not_configured" }, { status: 503 });
  if (!hasValidAdminRequest(request)) return NextResponse.json({ outcome: "unauthorized" }, { status: 401 });
  if (!hasAdminPermission(request, "audit:read")) return NextResponse.json({ outcome: "forbidden" }, { status: 403 });
  try {
    return NextResponse.json({ outcome: "ok", ...await autopayOperationalIssues() }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    logEvent("admin_autopay_diagnostics_failed", errorDetails(error), "error");
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}
