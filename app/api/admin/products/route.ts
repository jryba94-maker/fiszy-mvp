import { NextRequest, NextResponse } from "next/server";
import {
  hasAdminPermission,
  isAdminConfigured,
  isSameOriginAdminMutation,
} from "../../../../lib/admin-auth";
import { recordSuccessfulAdminAudit } from "../../../../lib/admin-audit";
import {
  createProduct,
  listProducts,
  normalizeProductInput,
} from "../../../../lib/product-storage";
import { looksLikeSortedSetCursor } from "../../../../lib/sorted-set-pagination";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isAdminConfigured()) {
    return NextResponse.json({ outcome: "admin_not_configured" }, { status: 503 });
  }
  if (!hasAdminPermission(request, "users:read")) {
    return NextResponse.json({ outcome: "forbidden" }, { status: 403 });
  }
  const cursor = request.nextUrl.searchParams.get("cursor");
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? 30);
  if (
    (cursor !== null && !looksLikeSortedSetCursor(cursor)) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 50
  ) {
    return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
  }
  try {
    const page = await listProducts({ cursor, limit });
    if (!page) return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
    return NextResponse.json(
      { outcome: "ok", ...page },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Unable to list products.", error);
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  if (!isAdminConfigured()) {
    return NextResponse.json({ outcome: "admin_not_configured" }, { status: 503 });
  }
  if (!hasAdminPermission(request, "auctions:write")) {
    return NextResponse.json({ outcome: "forbidden" }, { status: 403 });
  }
  if (!isSameOriginAdminMutation(request)) {
    return NextResponse.json({ outcome: "invalid_origin" }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
  }
  const input = normalizeProductInput(body);
  if (!input) return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
  try {
    const product = await createProduct(input);
    if (!product) return NextResponse.json({ outcome: "sku_exists" }, { status: 409 });
    const auditEventId = await recordSuccessfulAdminAudit(request, {
      action: "product.created",
      resourceType: "product",
      resourceId: product.productId,
      details: {
        status: product.status,
        inventoryMode: product.inventory.mode,
        revision: product.revision,
      },
    });
    return NextResponse.json(
      { outcome: "created", product, auditEventId },
      { status: 201 },
    );
  } catch (error) {
    console.error("Unable to create product.", error);
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}
