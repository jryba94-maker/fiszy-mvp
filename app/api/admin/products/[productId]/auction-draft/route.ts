import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { type AuctionRecord, normalizeAuctionId } from "../../../../../../lib/auction";
import { hasAdminPermission, isAdminConfigured, isSameOriginAdminMutation } from "../../../../../../lib/admin-auth";
import { recordSuccessfulAdminAudit } from "../../../../../../lib/admin-audit";
import { createAuctionRecord } from "../../../../../../lib/auction-storage";
import { productAuctionDefinition, readProduct } from "../../../../../../lib/product-storage";

export async function POST(request: NextRequest, context: { params: Promise<{ productId: string }> }) {
  if (!isAdminConfigured()) return NextResponse.json({ outcome: "admin_not_configured" }, { status: 503 });
  if (!hasAdminPermission(request, "auctions:write")) return NextResponse.json({ outcome: "forbidden" }, { status: 403 });
  if (!isSameOriginAdminMutation(request)) return NextResponse.json({ outcome: "invalid_origin" }, { status: 403 });
  const { productId } = await context.params;
  let body: Record<string, unknown> = {};
  try {
    const raw = await request.text();
    if (raw.trim()) {
      const payload: unknown = JSON.parse(raw);
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Invalid request body.");
      body = payload as Record<string, unknown>;
    }
  } catch {
    return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
  }
  try {
    const product = await readProduct(productId);
    if (!product || product.status === "archived") return NextResponse.json({ outcome: "not_found" }, { status: 404 });
    const auctionId = body.auctionId === undefined || body.auctionId === "" ? randomUUID() : normalizeAuctionId(body.auctionId);
    if (!auctionId) return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
    const now = new Date().toISOString();
    const record: AuctionRecord = { schemaVersion: 1, auctionId, state: "draft", currentRunId: null, revision: 1, createdAt: now, updatedAt: now, ...productAuctionDefinition(product) };
    const created = await createAuctionRecord(record, { productId: product.productId, expectedRevision: product.revision });
    if (created === 0) return NextResponse.json({ outcome: "auction_exists" }, { status: 409 });
    if (created === -1) return NextResponse.json({ outcome: "product_changed" }, { status: 409 });
    if (created !== 1) return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
    const auditEventId = await recordSuccessfulAdminAudit(request, { action: "auction.created", resourceType: "auction", resourceId: auctionId, details: { state: "draft", scheduled: false, revision: 1 } });
    return NextResponse.json({ outcome: "created", record, productId: product.productId, auditEventId }, { status: 201 });
  } catch (error) {
    console.error("Unable to create auction draft from product.", error);
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}
