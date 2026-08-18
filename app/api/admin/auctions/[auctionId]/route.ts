import { NextRequest, NextResponse } from "next/server";
import {
  type AuctionRecordState,
  getTimedAuctionState,
  normalizeAuctionId,
  parseAuctionDefinition,
} from "../../../../../lib/auction";
import {
  readAuctionRecord,
  readAuctionWinner,
  readOptionalAuctionConfig,
  updateAuctionRecordIfRevision,
} from "../../../../../lib/auction-storage";
import { readAdminAuction } from "../../../../../lib/auction-view";
import {
  hasAdminPermission,
  hasValidAdminRequest,
  isAdminConfigured,
  isSameOriginAdminMutation,
} from "../../../../../lib/admin-auth";
import { recordSuccessfulAdminAudit } from "../../../../../lib/admin-audit";
import { errorDetails, logEvent } from "../../../../../lib/observability";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ auctionId: string }> };

function authError(request: NextRequest) {
  if (!isAdminConfigured()) {
    return NextResponse.json(
      { outcome: "admin_not_configured" },
      { status: 503 },
    );
  }
  if (!hasValidAdminRequest(request)) {
    return NextResponse.json({ outcome: "unauthorized" }, { status: 401 });
  }
  return null;
}

export async function GET(request: NextRequest, context: Context) {
  const error = authError(request);
  if (error) return error;
  const { auctionId: rawAuctionId } = await context.params;
  const auctionId = normalizeAuctionId(rawAuctionId);
  if (!auctionId) {
    return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
  }

  try {
    const item = await readAdminAuction(auctionId);
    if (!item) {
      return NextResponse.json({ outcome: "not_found" }, { status: 404 });
    }
    return NextResponse.json(
      { outcome: "ok", ...item },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (caught) {
    logEvent("admin_auction_read_failed", errorDetails(caught), "error");
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  const error = authError(request);
  if (error) return error;
  if (!hasAdminPermission(request, "auctions:write")) {
    return NextResponse.json({ outcome: "forbidden" }, { status: 403 });
  }
  if (!isSameOriginAdminMutation(request)) {
    return NextResponse.json({ outcome: "invalid_origin" }, { status: 403 });
  }

  const { auctionId: rawAuctionId } = await context.params;
  const auctionId = normalizeAuctionId(rawAuctionId);
  if (!auctionId) {
    return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
  }

  try {
    const [record, config] = await Promise.all([
      readAuctionRecord(auctionId),
      readOptionalAuctionConfig(auctionId),
    ]);
    if (!record) {
      return NextResponse.json({ outcome: "not_found" }, { status: 404 });
    }

    const definition = parseAuctionDefinition({
      productName: body.productName ?? record.productName,
      productImageUrl:
        body.productImageUrl === undefined
          ? record.productImageUrl
          : body.productImageUrl,
      category: body.category ?? record.category,
      postAuctionOffer: body.postAuctionOffer ?? record.postAuctionOffer,
      regularPrice: body.regularPrice ?? record.regularPrice,
      startPrice: body.startPrice ?? record.startPrice,
      floorPrice: body.floorPrice ?? record.floorPrice,
      durationMinutes: body.durationMinutes ?? record.durationMinutes,
    });
    const requestedState = (body.state ?? record.state) as AuctionRecordState;
    const expectedRevision = body.expectedRevision ?? record.revision;
    if (
      !definition ||
      (requestedState !== "draft" &&
        requestedState !== "published" &&
        requestedState !== "archived") ||
      typeof expectedRevision !== "number" ||
      !Number.isInteger(expectedRevision) ||
      expectedRevision < 1 ||
      (requestedState === "published" && !config)
    ) {
      return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
    }

    const definitionChanged =
      definition.productName !== record.productName ||
      definition.productImageUrl !== record.productImageUrl ||
      definition.category !== record.category ||
      definition.postAuctionOffer.enabled !== record.postAuctionOffer.enabled ||
      definition.postAuctionOffer.validityDays !== record.postAuctionOffer.validityDays ||
      definition.postAuctionOffer.inventory !== record.postAuctionOffer.inventory ||
      definition.regularPrice !== record.regularPrice ||
      definition.startPrice !== record.startPrice ||
      definition.floorPrice !== record.floorPrice ||
      definition.durationMinutes !== record.durationMinutes;

    let activeMutationBlocked = false;
    if (config) {
      const winner = await readAuctionWinner(config.runId, auctionId);
      const state = getTimedAuctionState(Date.now(), config);
      activeMutationBlocked =
        winner?.paymentStatus === "pending" ||
        (!winner && state.status !== "ended");
    }

    if (
      activeMutationBlocked &&
      (definitionChanged ||
        requestedState === "archived" ||
        (record.state === "published" && requestedState !== "published"))
    ) {
      return NextResponse.json(
        { outcome: "auction_in_progress" },
        { status: 409 },
      );
    }

    const nextRecord = {
      ...record,
      ...definition,
      state: requestedState,
      revision: record.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    const result = await updateAuctionRecordIfRevision(
      expectedRevision,
      nextRecord,
      config ? new Date(config.startsAt).getTime() : null,
    );
    if (result !== 1) {
      return NextResponse.json(
        { outcome: "auction_changed" },
        { status: 409 },
      );
    }

    logEvent("admin_auction_updated", {
      auctionId,
      state: nextRecord.state,
      revision: nextRecord.revision,
    });
    const auditEventId = await recordSuccessfulAdminAudit(request, {
      action: "auction.updated",
      resourceType: "auction",
      resourceId: auctionId,
      details: {
        previousState: record.state,
        state: nextRecord.state,
        revision: nextRecord.revision,
        definitionChanged,
      },
    });
    return NextResponse.json({
      outcome: "updated",
      record: nextRecord,
      auditEventId,
    });
  } catch (caught) {
    logEvent("admin_auction_update_failed", errorDetails(caught), "error");
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}
