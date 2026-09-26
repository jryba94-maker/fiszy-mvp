import { NextRequest, NextResponse } from "next/server";
import { hasValidAdminRequest, isAdminConfigured } from "../../../../lib/admin-auth";
import { legalDocumentHistory } from "../../../../lib/legal-document-history";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isAdminConfigured()) return NextResponse.json({ outcome: "admin_not_configured" }, { status: 503 });
  if (!hasValidAdminRequest(request)) return NextResponse.json({ outcome: "unauthorized" }, { status: 401 });
  return NextResponse.json({ outcome: "ok", documents: legalDocumentHistory.map(({ content, ...document }) => document) }, { headers: { "Cache-Control": "no-store" } });
}
