import { NextRequest, NextResponse } from "next/server";
import { hasAdminPermission, isAdminConfigured } from "../../../../lib/admin-auth";
import { readBusinessFunnel } from "../../../../lib/business-analytics";
import { readLandingTraffic } from "../../../../lib/landing-traffic";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isAdminConfigured()) return NextResponse.json({ outcome: "admin_not_configured" }, { status: 503 });
  if (!hasAdminPermission(request, "audit:read")) return NextResponse.json({ outcome: "forbidden" }, { status: 403 });
  const days = Number(request.nextUrl.searchParams.get("days") ?? 30);
  try {
    const [traffic, business] = await Promise.all([readLandingTraffic(days), readBusinessFunnel(days)]);
    if (!traffic || !business) return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
    return NextResponse.json({ outcome: "ok", traffic, business }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ outcome: "storage_error" }, { status: 503 }); }
}
