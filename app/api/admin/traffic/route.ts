import { NextRequest, NextResponse } from "next/server";
import { hasAdminPermission, isAdminConfigured } from "../../../../lib/admin-auth";
import { readLandingTraffic } from "../../../../lib/landing-traffic";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isAdminConfigured()) return NextResponse.json({ outcome: "admin_not_configured" }, { status: 503 });
  if (!hasAdminPermission(request, "audit:read")) return NextResponse.json({ outcome: "forbidden" }, { status: 403 });
  const traffic = await readLandingTraffic(Number(request.nextUrl.searchParams.get("days") ?? 30));
  return traffic ? NextResponse.json({ outcome: "ok", traffic }, { headers: { "Cache-Control": "no-store" } }) : NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
}
