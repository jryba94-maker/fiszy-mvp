import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  type AuctionConfig,
  getAuctionEndsAt,
  getTimedAuctionState,
  normalizeAuctionId,
} from "../../../../../../lib/auction";
import {
  releaseAuctionWinner,
  readAuctionRecord,
  readAuctionWinner,
  readOptionalAuctionConfig,
  scheduleAuctionRunIfRevision,
} from "../../../../../../lib/auction-storage";
import {
  hasValidAdminRequest,
  isAdminConfigured,
  isSameOriginAdminMutation,
} from "../../../../../../lib/admin-auth";
import {
  expireCheckoutSession,
  retrieveCheckoutSession,
} from "../../../../../../lib/stripe";
import { errorDetails, logEvent } from "../../../../../../lib/observability";

export const dynamic = "force-dynamic";

const START_DELAY_MS = 60_000;
const PURCHASE_CHECKOUT_WINDOW_MS = 31 * 60 * 1000;

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

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ auctionId: string }> },
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
          if (!process.env.STRIPE_SECRET_KEY) {
            return NextResponse.json(
              { outcome: "pending_payment_recovery_unavailable" },
              { status: 409 },
            );
          }

          const session = await retrieveCheckoutSession(winner.paymentSessionId);
          if (session.payment_status === "paid" || session.status === "complete") {
            return NextResponse.json(
              { outcome: "pending_payment_reconciliation" },
              { status: 409 },
            );
          }
          if (session.status === "open") {
            const expired = await expireCheckoutSession(winner.paymentSessionId);
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

    return NextResponse.json(
      {
        outcome: "scheduled",
        auctionId,
        runId: config.runId,
        startsAt: config.startsAt,
        endsAt: getAuctionEndsAt(config).toISOString(),
      },
      { status: 201 },
    );
  } catch (caught) {
    logEvent("admin_auction_run_schedule_failed", errorDetails(caught), "error");
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}
