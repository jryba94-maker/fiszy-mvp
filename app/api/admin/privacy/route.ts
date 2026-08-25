import { NextRequest, NextResponse } from "next/server";
import { hasAdminPermission, isAdminConfigured } from "../../../../lib/admin-auth";
import { listPrivacyRequests } from "../../../../lib/privacy-storage";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isAdminConfigured()) return NextResponse.json({ outcome: "admin_not_configured" }, { status: 503 });
  if (!hasAdminPermission(request, "users:write")) return NextResponse.json({ outcome: "forbidden" }, { status: 403 });
  try {
    const page = await listPrivacyRequests({ cursor: request.nextUrl.searchParams.get("cursor"), limit: 30 });
    if (!page) return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
    return NextResponse.json({ outcome: "ok", ...page }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Unable to list privacy requests.", error);
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}
