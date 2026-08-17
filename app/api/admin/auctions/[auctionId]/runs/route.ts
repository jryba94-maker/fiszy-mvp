import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  type AuctionConfig,
  type PublicAuctionStatus,
  getAuctionEndsAt,
  getTimedAuctionState,
  normalizeAuctionId,
} from "../../../../../../lib/auction";
import {
  type AuctionWinner,
  listAuctionRunIds,
  readAuctionRunHistoryDetails,
  releaseAuctionWinner,
  readAuctionRecord,
  readAuctionWinner,
  readOptionalAuctionConfig,
  scheduleAuctionRunIfRevision,
} from "../../../../../../lib/auction-storage";
import type { AuctionOrder } from "../../../../../../lib/order-storage";
import {
  hasValidAdminRequest,
  isAdminConfigured,
  isSameOriginAdminMutation,
} from "../../../../../../lib/admin-auth";
import { recordSuccessfulAdminAudit } from "../../../../../../lib/admin-audit";
import {
  expirePaymentSession,
  isPaymentProviderConfigured,
  retrievePaymentSession,
} from "../../../../../../lib/payment-provider";
import { errorDetails, logEvent } from "../../../../../../lib/observability";

export const dynamic = "force-dynamic";

const START_DELAY_MS = 60_000;
const PURCHASE_CHECKOUT_WINDOW_MS = 31 * 60 * 1000;

type AuctionContext = { params: Promise<{ auctionId: string }> };

function computedRunStatus(
  now: number,
  config: AuctionConfig,
  winner: AuctionWinner | null,
  order: AuctionOrder | null,
): PublicAuctionStatus {
  if (order) return "sold";
  if (winner) {
    return winner.paymentStatus === "pending" ? "payment_pending" : "sold";
  }
  return getTimedAuctionState(now, config).status;
}

function winnerSummary(
  winner: AuctionWinner | null,
  order: AuctionOrder | null,
) {
  if (winner) {
    return {
      bidderId: winner.bidderId,
      price: winner.price,
      claimedAt: winner.claimedAt,
      paymentStatus: winner.paymentStatus ?? "paid",
      paymentExpiresAt: winner.paymentExpiresAt ?? null,
      paidAt: winner.paidAt ?? order?.paidAt ?? null,
    };
  }

  return order
    ? {
        bidderId: order.bidderId,
        price: order.amount,
        claimedAt: null,
        paymentStatus: "paid" as const,
        paymentExpiresAt: null,
        paidAt: order.paidAt,
      }
    : null;
}

function orderSummary(order: AuctionOrder | null) {
  return order
    ? {
        orderId: order.orderId,
        amount: order.amount,
        currency: order.currency,
        paidAt: order.paidAt,
      }
    : null;
}

function pendingPaymentExpiresAt(winner: {
  claimedAt: string;
  paymentExpiresAt?: string;
}) {
  const explicit = winner.paymentExpiresAt
    ? Date.parse(winner.paymentExpiresAt)
    : Number.NaN;
  if (Number.isFinite(explicit)) return explicit;

  const claimedAt = Date.parse(winner.claimedAt);
  return Number.isFinite(claimedAt)
    ? claimedAt + PURCHASE_CHECKOUT_WINDOW_MS
    : Number.NaN;
}

export async function GET(request: NextRequest, context: AuctionContext) {
  if (!isAdminConfigured()) {
    return NextResponse.json(
      { outcome: "admin_not_configured" },
      { status: 503 },
    );
  }
  if (!hasValidAdminRequest(request)) {
    return NextResponse.json({ outcome: "unauthorized" }, { status: 401 });
  }

  const { auctionId: rawAuctionId } = await context.params;
  const auctionId = normalizeAuctionId(rawAuctionId);
  const cursor = request.nextUrl.searchParams.get("cursor");
  const limitValue = request.nextUrl.searchParams.get("limit");
  const limit = limitValue === null ? 20 : Number(limitValue);
  if (
    !auctionId ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 50
  ) {
    return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
  }

  try {
    const record = await readAuctionRecord(auctionId);
    if (!record) {
      return NextResponse.json({ outcome: "not_found" }, { status: 404 });
    }

    const page = await listAuctionRunIds({ auctionId, cursor, limit });
    if (!page) {
      return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
    }

    const details = await readAuctionRunHistoryDetails(page.runIds, auctionId);
    const detailsByRunId = new Map(
      details.map((detail) => [detail.runId, detail] as const),
    );
    const now = Date.now();
    const runs = page.runs.map(({ runId, config }) => {
      const detail = detailsByRunId.get(runId);
      if (!detail) throw new Error("Auction run history detail is missing.");
      return {
        config,
        endsAt: getAuctionEndsAt(config).toISOString(),
        status: computedRunStatus(now, config, detail.winner, detail.order),
        participantCount: detail.participantCount,
        winner: winnerSummary(detail.winner, detail.order),
        order: orderSummary(detail.order),
        isCurrent: record.currentRunId === runId,
      };
    });

    return NextResponse.json(
      {
        outcome: "ok",
        auctionId,
        runs,
        nextCursor: page.nextCursor,
        serverTime: new Date(now).toISOString(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (caught) {
    logEvent(
      "admin_auction_run_list_failed",
      { auctionId, ...errorDetails(caught) },
      "error",
    );
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}

export async function POST(
  request: NextRequest,
  context: AuctionContext,
) {
  if (!isAdminConfigured()) {
    return NextResponse.json(
      { outcome: "admin_not_configured" },
      { status: 503 },
    );
  }
  if (!hasValidAdminRequest(request)) {
    return NextResponse.json({ outcome: "unauthorized" }, { status: 401 });
  }
  if (!isSameOriginAdminMutation(request)) {
    return NextResponse.json({ outcome: "invalid_origin" }, { status: 403 });
  }

  const { auctionId: rawAuctionId } = await context.params;
  const auctionId = normalizeAuctionId(rawAuctionId);
  if (!auctionId) {
    return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
  }

  let body: Record<string, unknown> = {};
  try {
    const raw = await request.text();
    if (raw.trim()) body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
  }

  try {
    const [record, currentConfig] = await Promise.all([
      readAuctionRecord(auctionId),
      readOptionalAuctionConfig(auctionId),
    ]);
    if (!record) {
      return NextResponse.json({ outcome: "not_found" }, { status: 404 });
    }
    if (record.state === "archived") {
      return NextResponse.json({ outcome: "auction_archived" }, { status: 409 });
    }

    if (currentConfig) {
      let winner = await readAuctionWinner(currentConfig.runId, auctionId);
      if (winner?.paymentStatus === "pending") {
        const expiresAt = pendingPaymentExpiresAt(winner);
        if (!Number.isFinite(expiresAt) || expiresAt > Date.now()) {
          return NextResponse.json({ outcome: "pending_payment" }, { status: 409 });
        }

        if (winner.paymentSessionId) {
          if (!isPaymentProviderConfigured()) {
            return NextResponse.json(
              { outcome: "pending_payment_recovery_unavailable" },
              { status: 409 },
            );
          }

          const session = await retrievePaymentSession(winner.paymentSessionId);
          if (session.payment_status === "paid" || session.status === "complete") {
            return NextResponse.json(
              { outcome: "pending_payment_reconciliation" },
              { status: 409 },
            );
          }
          if (session.status === "open") {
            const expired = await expirePaymentSession(winner.paymentSessionId);
            if (expired.status !== "expired") {
              return NextResponse.json(
                { outcome: "pending_payment" },
                { status: 409 },
              );
            }
          } else if (session.status !== "expired") {
            return NextResponse.json(
              { outcome: "pending_payment" },
              { status: 409 },
            );
          }
        }

        const released = await releaseAuctionWinner(
          currentConfig.runId,
          winner.bidderId,
          winner.paymentSessionId,
          auctionId,
          winner.claimedAt,
        );
        if (released !== 1) {
          winner = await readAuctionWinner(currentConfig.runId, auctionId);
          if (winner) {
            return NextResponse.json(
              { outcome: "auction_changed" },
              { status: 409 },
            );
          }
        } else {
          logEvent("stale_winner_recovered", {
            auctionId,
            runId: currentConfig.runId,
          }, "warning");
          winner = null;
        }
      }
      if (!winner) {
        const timed = getTimedAuctionState(Date.now(), currentConfig);
        if (timed.status !== "ended") {
          return NextResponse.json(
            { outcome: "auction_in_progress" },
            { status: 409 },
          );
        }
      }
    }

    const startsAt =
      typeof body.startsAt === "string" && body.startsAt
        ? new Date(body.startsAt)
        : new Date(Date.now() + START_DELAY_MS);
    const expectedRevision = body.expectedRevision ?? record.revision;
    const publish = body.publish !== false;
    if (
      !Number.isFinite(startsAt.getTime()) ||
      startsAt.getTime() <= Date.now() ||
      typeof expectedRevision !== "number" ||
      !Number.isInteger(expectedRevision) ||
      expectedRevision < 1
    ) {
      return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
    }

    const config: AuctionConfig = {
      schemaVersion: 2,
      runId: randomUUID(),
      startsAt: startsAt.toISOString(),
      productName: record.productName,
      productImageUrl: record.productImageUrl,
      regularPrice: record.regularPrice,
      startPrice: record.startPrice,
      floorPrice: record.floorPrice,
      durationMinutes: record.durationMinutes,
    };
    const nextRecord = {
      ...record,
      state: publish ? "published" as const : record.state,
      currentRunId: config.runId,
      revision: record.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    const result = await scheduleAuctionRunIfRevision(
      expectedRevision,
      nextRecord,
      config,
    );
    if (result === 0) {
      return NextResponse.json(
        { outcome: "auction_changed" },
        { status: 409 },
      );
    }
    if (result !== 1) {
      return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
    }


    logEvent("admin_auction_run_scheduled", {
      auctionId,
      runId: config.runId,
      startsAt: config.startsAt,
    });
    const auditEventId = await recordSuccessfulAdminAudit(request, {
      action: "auction.run.scheduled",
      resourceType: "auction",
      resourceId: auctionId,
      details: {
        runId: config.runId,
        startsAt: config.startsAt,
        revision: nextRecord.revision,
      },
    });

    return NextResponse.json(
      {
        outcome: "scheduled",
        auctionId,
        runId: config.runId,
        startsAt: config.startsAt,
        endsAt: getAuctionEndsAt(config).toISOString(),
        auditEventId,
      },
      { status: 201 },
    );
  } catch (caught) {
    logEvent("admin_auction_run_schedule_failed", errorDetails(caught), "error");
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}
