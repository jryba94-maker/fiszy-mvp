import { NextRequest, NextResponse } from "next/server";
import { hasAdminPermission, hasValidAdminRequest, isAdminConfigured } from "../../../../lib/admin-auth";
import { readMarketingConsentDashboard } from "../../../../lib/marketing-consents";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

export async function GET(request: NextRequest) {
  if (!isAdminConfigured()) return NextResponse.json({ outcome: "admin_not_configured" }, { status: 503 });
  if (!hasValidAdminRequest(request)) return NextResponse.json({ outcome: "unauthorized" }, { status: 401 });
  if (!hasAdminPermission(request, "audit:read")) return NextResponse.json({ outcome: "forbidden" }, { status: 403 });
  const range = request.nextUrl.searchParams.get("range") === "90" ? 90 : 30;
  try {
    const dashboard = await readMarketingConsentDashboard(range);
    if (request.nextUrl.searchParams.get("format") === "csv") {
      const rows = dashboard.rows.filter((row) => row.status === "active");
      const csv = ["E-mail;Status;Źródło;Ostatnia zmiana", ...rows.map((row) => [row.email, "Aktywna", row.source, row.updatedAt].map(csvCell).join(";"))].join("\n");
      return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="fiszy-zgody-marketingowe.csv"', "Cache-Control": "private, no-store" } });
    }
    return NextResponse.json({ outcome: "ok", ...dashboard }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Unable to read marketing consents.", error);
    return NextResponse.json({ outcome: "storage_or_provider_error" }, { status: 503 });
  }
}
