import { NextRequest, NextResponse } from "next/server";
import { hasAdminPermission, isAdminConfigured } from "../../../../lib/admin-auth";
import { readBusinessFunnel } from "../../../../lib/business-analytics";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isAdminConfigured()) return NextResponse.json({ outcome: "admin_not_configured" }, { status: 503 });
  if (!hasAdminPermission(request, "audit:read")) return NextResponse.json({ outcome: "forbidden" }, { status: 403 });
  const days = Number(request.nextUrl.searchParams.get("days") ?? 30);
  try {
    const funnel = await readBusinessFunnel(days);
    if (!funnel) return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
    return NextResponse.json({ outcome: "ok", funnel }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Unable to read business analytics.", error);
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}
