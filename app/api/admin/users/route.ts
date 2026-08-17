import { NextRequest, NextResponse } from "next/server";
import { hasAdminPermission, isAdminConfigured } from "../../../../lib/admin-auth";
import {
  listAccountProfiles,
  readAccountAdminRecords,
} from "../../../../lib/portal-storage";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isAdminConfigured()) return NextResponse.json({ outcome: "admin_not_configured" }, { status: 503 });
  if (!hasAdminPermission(request, "users:read")) return NextResponse.json({ outcome: "forbidden" }, { status: 403 });
  const cursor = request.nextUrl.searchParams.get("cursor");
  const limitValue = request.nextUrl.searchParams.get("limit");
  const limit = limitValue === null ? 20 : Number(limitValue);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
  try {
    const page = await listAccountProfiles({ cursor, limit });
    if (!page) return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
    const administration = await readAccountAdminRecords(page.profiles.map((profile) => profile.accountId));
    const users = page.profiles.map((profile, index) => ({ profile, administration: administration[index] }));
    return NextResponse.json({ outcome: "ok", users, nextCursor: page.nextCursor }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Unable to list portal users.", error);
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}
