import { NextRequest, NextResponse } from "next/server";
import { hasValidAdminRequest, isAdminConfigured } from "../../../../../../../lib/admin-auth";
import { findLegalDocumentVersion } from "../../../../../../../lib/legal-document-history";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ documentId: string; version: string }> }) {
  if (!isAdminConfigured()) return NextResponse.json({ outcome: "admin_not_configured" }, { status: 503 });
  if (!hasValidAdminRequest(request)) return NextResponse.json({ outcome: "unauthorized" }, { status: 401 });
  const { documentId, version } = await params;
  const document = findLegalDocumentVersion(documentId, version);
  if (!document) return NextResponse.json({ outcome: "not_found" }, { status: 404 });
  return new NextResponse(document.content, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="${document.fileName}"`, "Cache-Control": "no-store" } });
}
