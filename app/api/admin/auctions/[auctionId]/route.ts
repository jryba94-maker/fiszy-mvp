import { NextRequest, NextResponse } from "next/server";
import {
  type AuctionRecordState,
  auctionPublishIssues,
  getAuctionEndsAt,
  getTimedAuctionState,
  normalizeAuctionId,
  normalizeRunId,
  parseAuctionDefinition,
} from "../../../../../lib/auction";
import {
  cancelCurrentAuctionRun,
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
    const payload: unknown = await request.json();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
    }
    body = payload as Record<string, unknown>;
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

    if (body.action === "cancel_run") {
      const runId = normalizeRunId(body.runId);
      const revision = body.expectedRevision;
      if (!runId || typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 1) {
        return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
      }
      if (!config || config.runId !== runId || getTimedAuctionState(Date.now(), config).status === "ended") {
        return NextResponse.json({ outcome: "auction_changed" }, { status: 409 });
      }
      const result = await cancelCurrentAuctionRun(auctionId, runId, revision, getAuctionEndsAt(config).getTime());
      if (result !== 1) return NextResponse.json({ outcome: result === -1 ? "pending_payment" : "auction_changed" }, { status: 409 });
      await recordSuccessfulAdminAudit(request, {
        action: "auction.updated", resourceType: "auction", resourceId: auctionId,
        details: { previousState: "published", state: "draft", revision: revision + 1, definitionChanged: false },
      });
      logEvent("admin_auction_run_cancelled", { auctionId, runId, refunds: "manual" });
      return NextResponse.json({ outcome: "ok", message: "Runda anulowana. Wpłaty sprawdź w historii rundy; zwroty wykonaj ręcznie." });
    }

    const definition = parseAuctionDefinition({
      productName: body.productName ?? record.productName,
      productImageUrl:
        body.productImageUrl === undefined
          ? record.productImageUrl
          : body.productImageUrl,
      category: body.category ?? record.category,
      postAuctionOffer: body.postAuctionOffer ?? record.postAuctionOffer,
      entryFee: body.entryFee ?? record.entryFee,
      regularPrice: body.regularPrice ?? record.regularPrice,
      lowestPrice30DaysBeforeAuction: body.lowestPrice30DaysBeforeAuction === undefined ? record.lowestPrice30DaysBeforeAuction : body.lowestPrice30DaysBeforeAuction,
      noPreviousOffer: body.noPreviousOffer ?? record.noPreviousOffer,
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
    if (requestedState === "published") {
      const issues = auctionPublishIssues(definition);
      if (issues.length) return NextResponse.json({ outcome: "auction_not_ready", issues }, { status: 400 });
    }

    const productChanged =
      definition.productName !== record.productName ||
      definition.productImageUrl !== record.productImageUrl ||
      definition.category !== record.category;
    const termsChanged =
      definition.postAuctionOffer.enabled !== record.postAuctionOffer.enabled ||
      definition.postAuctionOffer.validityDays !== record.postAuctionOffer.validityDays ||
      definition.postAuctionOffer.inventory !== record.postAuctionOffer.inventory ||
      definition.entryFee !== record.entryFee ||
      definition.regularPrice !== record.regularPrice ||
      (definition.lowestPrice30DaysBeforeAuction ?? null) !== (record.lowestPrice30DaysBeforeAuction ?? null) ||
      Boolean(definition.noPreviousOffer) !== Boolean(record.noPreviousOffer) ||
      definition.startPrice !== record.startPrice ||
      definition.floorPrice !== record.floorPrice ||
      definition.durationMinutes !== record.durationMinutes;
    const definitionChanged = productChanged || termsChanged;

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
      (termsChanged ||
        requestedState === "archived" ||
        (record.state === "published" && requestedState !== "published"))
    ) {
      return NextResponse.json(
        { outcome: "auction_in_progress", message: "Podczas aktywnej rundy możesz zmienić nazwę, zdjęcie i kategorię. Cena, wpisowe, czas trwania i warunki rabatu pozostają bez zmian." },
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
    const enableRunOffer = !record.postAuctionOffer.enabled && definition.postAuctionOffer.enabled;
    const currentRunUpdate = config && config.runId === record.currentRunId && (enableRunOffer || (activeMutationBlocked && productChanged)) ? {
      runId: config.runId,
      ...(enableRunOffer ? { postAuctionOffer: definition.postAuctionOffer } : {}),
      ...(activeMutationBlocked && productChanged ? { product: {
        productName: definition.productName,
        productImageUrl: definition.productImageUrl,
        category: definition.category,
      } } : {}),
    } : undefined;
    const result = await updateAuctionRecordIfRevision(
      expectedRevision,
      nextRecord,
      config ? new Date(config.startsAt).getTime() : null,
      currentRunUpdate,
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
