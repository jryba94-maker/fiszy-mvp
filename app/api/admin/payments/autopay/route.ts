import { NextRequest, NextResponse } from "next/server";
import { hasValidAdminRequest, isAdminConfigured, hasAdminPermission } from "../../../../../lib/admin-auth";
import { autopayOperationalIssues } from "../../../../../lib/autopay-storage";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  if (!isAdminConfigured() || !hasValidAdminRequest(request) || !hasAdminPermission(request, "audit:read")) return NextResponse.json({ outcome: "unauthorized" }, { status: 401 });
  return NextResponse.json({ outcome: "ok", ...await autopayOperationalIssues() }, { headers: { "Cache-Control": "private, no-store" } });
}
