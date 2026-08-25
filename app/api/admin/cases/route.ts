import { NextRequest, NextResponse } from "next/server";
import { hasAdminPermission, isAdminConfigured } from "../../../../lib/admin-auth";
import { listServiceCases, SERVICE_CASE_STATUSES, type ServiceCaseStatus } from "../../../../lib/service-case-storage";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isAdminConfigured()) return NextResponse.json({ outcome: "admin_not_configured" }, { status: 503 });
  if (!hasAdminPermission(request, "users:read")) return NextResponse.json({ outcome: "forbidden" }, { status: 403 });
  const statusValue = request.nextUrl.searchParams.get("status");
  if (statusValue && !SERVICE_CASE_STATUSES.includes(statusValue as ServiceCaseStatus)) {
    return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
  }
  try {
    const page = await listServiceCases({ cursor: request.nextUrl.searchParams.get("cursor"), limit: 30, status: statusValue as ServiceCaseStatus | null });
    if (!page) return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
    return NextResponse.json({ outcome: "ok", ...page }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Unable to list service cases.", error);
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}
