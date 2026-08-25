import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  auctionDefinitionFromConfig,
  normalizeAuctionId,
  type AuctionRecord,
} from "../../../../../../lib/auction";
import {
  createAuctionRecord,
  readAuctionRecord,
  readOptionalAuctionConfig,
} from "../../../../../../lib/auction-storage";
import {
  hasAdminPermission,
  isAdminConfigured,
  isSameOriginAdminMutation,
} from "../../../../../../lib/admin-auth";
import { recordSuccessfulAdminAudit } from "../../../../../../lib/admin-audit";
import { linkProductAuction, readAuctionProductId } from "../../../../../../lib/product-storage";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ auctionId: string }> },
) {
  if (!isAdminConfigured()) {
    return NextResponse.json({ outcome: "admin_not_configured" }, { status: 503 });
  }
  if (!hasAdminPermission(request, "auctions:write")) {
    return NextResponse.json({ outcome: "forbidden" }, { status: 403 });
  }
  if (!isSameOriginAdminMutation(request)) {
    return NextResponse.json({ outcome: "invalid_origin" }, { status: 403 });
  }
  const { auctionId: rawAuctionId } = await context.params;
  const sourceAuctionId = normalizeAuctionId(rawAuctionId);
  if (!sourceAuctionId) {
    return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
  }
  try {
    const [sourceRecord, sourceConfig] = await Promise.all([
      readAuctionRecord(sourceAuctionId),
      readOptionalAuctionConfig(sourceAuctionId),
    ]);
    if (!sourceRecord) {
      return NextResponse.json({ outcome: "not_found" }, { status: 404 });
    }
    const definition = sourceConfig
      ? auctionDefinitionFromConfig(sourceConfig)
      : {
          productName: sourceRecord.productName,
          productImageUrl: sourceRecord.productImageUrl,
          category: sourceRecord.category,
          postAuctionOffer: sourceRecord.postAuctionOffer,
          entryFee: sourceRecord.entryFee,
          regularPrice: sourceRecord.regularPrice,
          startPrice: sourceRecord.startPrice,
          floorPrice: sourceRecord.floorPrice,
          durationMinutes: sourceRecord.durationMinutes,
        };
    const now = new Date().toISOString();
    const record: AuctionRecord = {
      schemaVersion: 1,
      auctionId: randomUUID(),
      state: "draft",
      currentRunId: null,
      revision: 1,
      createdAt: now,
      updatedAt: now,
      ...definition,
      productName: `${definition.productName} — kopia`.slice(0, 80),
    };
    const created = await createAuctionRecord(record);
    if (created !== 1) {
      return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
    }
    const sourceProductId = await readAuctionProductId(sourceAuctionId);
    const productLinked = sourceProductId
      ? await linkProductAuction(sourceProductId, record.auctionId)
      : false;
    const auditEventId = await recordSuccessfulAdminAudit(request, {
      action: "auction.duplicated",
      resourceType: "auction",
      resourceId: record.auctionId,
      details: {
        sourceAuctionId,
        state: record.state,
        revision: record.revision,
      },
    });
    return NextResponse.json(
      { outcome: "created", record, productLinked, auditEventId },
      { status: 201 },
    );
  } catch (error) {
    console.error("Unable to duplicate auction.", error);
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}
