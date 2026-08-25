import { NextRequest, NextResponse } from "next/server";
import {
  hasAdminPermission,
  isAdminConfigured,
  isSameOriginAdminMutation,
} from "../../../../../lib/admin-auth";
import { recordSuccessfulAdminAudit } from "../../../../../lib/admin-audit";
import {
  normalizeProductId,
  normalizeProductInput,
  readProduct,
  updateProduct,
} from "../../../../../lib/product-storage";

type Context = { params: Promise<{ productId: string }> };

export async function GET(request: NextRequest, context: Context) {
  if (!isAdminConfigured()) {
    return NextResponse.json({ outcome: "admin_not_configured" }, { status: 503 });
  }
  if (!hasAdminPermission(request, "users:read")) {
    return NextResponse.json({ outcome: "forbidden" }, { status: 403 });
  }
  const { productId: rawProductId } = await context.params;
  const productId = normalizeProductId(rawProductId);
  if (!productId) return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
  try {
    const product = await readProduct(productId);
    if (!product) return NextResponse.json({ outcome: "not_found" }, { status: 404 });
    return NextResponse.json(
      { outcome: "ok", product },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Unable to read product.", error);
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  if (!isAdminConfigured()) {
    return NextResponse.json({ outcome: "admin_not_configured" }, { status: 503 });
  }
  if (!hasAdminPermission(request, "auctions:write")) {
    return NextResponse.json({ outcome: "forbidden" }, { status: 403 });
  }
  if (!isSameOriginAdminMutation(request)) {
    return NextResponse.json({ outcome: "invalid_origin" }, { status: 403 });
  }
  const { productId: rawProductId } = await context.params;
  const productId = normalizeProductId(rawProductId);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
  }
  const candidate = body && typeof body === "object" ? body as Record<string, unknown> : null;
  const expectedRevision = candidate?.expectedRevision;
  const productInput = normalizeProductInput(candidate?.product);
  if (!productId || !Number.isInteger(expectedRevision) || !productInput) {
    return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
  }
  try {
    const previous = await readProduct(productId);
    if (!previous) return NextResponse.json({ outcome: "not_found" }, { status: 404 });
    const product = await updateProduct({
      productId,
      expectedRevision: Number(expectedRevision),
      product: productInput,
    });
    if (!product) return NextResponse.json({ outcome: "revision_or_sku_conflict" }, { status: 409 });
    const auditEventId = await recordSuccessfulAdminAudit(request, {
      action: "product.updated",
      resourceType: "product",
      resourceId: productId,
      details: {
        status: product.status,
        inventoryMode: product.inventory.mode,
        skuChanged: previous.sku !== product.sku,
        revision: product.revision,
      },
    });
    return NextResponse.json({ outcome: "ok", product, auditEventId });
  } catch (error) {
    console.error("Unable to update product.", error);
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}
