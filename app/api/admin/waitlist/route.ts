import { NextRequest, NextResponse } from "next/server";
import { hasAdminPermission, isAdminConfigured } from "../../../../lib/admin-auth";
import { listRecentWaitlistSignups } from "../../../../lib/waitlist-storage";

export const dynamic = "force-dynamic";

function csvCell(value: string | null) {
  return `"${(value ?? "").replaceAll('"', '""')}"`;
}

export async function GET(request: NextRequest) {
  if (!isAdminConfigured()) {
    return NextResponse.json({ outcome: "admin_not_configured" }, { status: 503 });
  }
  if (!hasAdminPermission(request, "users:read")) {
    return NextResponse.json({ outcome: "forbidden" }, { status: 403 });
  }

  try {
    const result = await listRecentWaitlistSignups(500);
    if (request.nextUrl.searchParams.get("format") === "csv") {
      const rows = [
        ["email", "zapisano", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "referrer"],
        ...result.signups.map((signup) => [
          signup.email,
          signup.createdAt,
          signup.source.utmSource,
          signup.source.utmMedium,
          signup.source.utmCampaign,
          signup.source.utmContent,
          signup.source.utmTerm,
          signup.source.referrerHost,
        ]),
      ];
      const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
      return new NextResponse(csv, {
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
          "Content-Disposition": "attachment; filename=fiszy-pierwsza-aukcja.csv",
          "Content-Type": "text/csv; charset=utf-8",
          "X-Waitlist-Total": String(result.total),
        },
      });
    }
    return NextResponse.json(
      { outcome: "ok", ...result },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  } catch (error) {
    console.error("Unable to export waitlist.", error);
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}
