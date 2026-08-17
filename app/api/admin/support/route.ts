import { NextRequest, NextResponse } from "next/server";
import { hasAdminPermission, isAdminConfigured } from "../../../../lib/admin-auth";
import { listSupportTickets } from "../../../../lib/portal-storage";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isAdminConfigured()) return NextResponse.json({ outcome: "admin_not_configured" }, { status: 503 });
  if (!hasAdminPermission(request, "users:read")) return NextResponse.json({ outcome: "forbidden" }, { status: 403 });
  const cursor = request.nextUrl.searchParams.get("cursor");
  try {
    const page = await listSupportTickets({ cursor, limit: 30 });
    if (!page) return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
    return NextResponse.json({ outcome: "ok", ...page }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Unable to list support tickets.", error);
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}
