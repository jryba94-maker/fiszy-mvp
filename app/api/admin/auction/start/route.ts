import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  type AuctionDefinition,
  type AuctionConfig,
  auctionDefinitionFromConfig,
  getAuctionEndsAt,
  getTimedAuctionState,
  parseAuctionDefinition,
} from "../../../../../lib/auction";
import {
  readAuctionConfig,
  readAuctionWinner,
  releaseAuctionWinner,
  writeAuctionConfigIfCurrent,
} from "../../../../../lib/auction-storage";
import {
  readAuctionOrder,
  saveAuctionOrder,
} from "../../../../../lib/order-storage";
import {
  expirePaymentSession,
  isPaymentProviderConfigured,
  retrievePaymentSession,
} from "../../../../../lib/payment-provider";
import {
  hasAdminPermission,
  hasValidAdminRequest,
  isAdminConfigured,
  isSameOriginAdminMutation,
} from "../../../../../lib/admin-auth";

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

export async function POST(request: NextRequest) {
  if (!isAdminConfigured()) {
    return NextResponse.json(
      { outcome: "admin_not_configured" },
      { status: 503 },
    );
  }

  if (!hasValidAdminRequest(request)) {
    return NextResponse.json({ outcome: "unauthorized" }, { status: 401 });
  }
  if (!hasAdminPermission(request, "auctions:write")) {
    return NextResponse.json({ outcome: "forbidden" }, { status: 403 });
  }
  if (!isSameOriginAdminMutation(request)) {
    return NextResponse.json({ outcome: "invalid_origin" }, { status: 403 });
  }

  let requestedDefinition: AuctionDefinition | undefined;
  let requestedStartsAt: Date | undefined;

  try {
    const rawBody = await request.text();
    if (rawBody.trim()) {
      const body = JSON.parse(rawBody) as Record<string, unknown>;
      requestedDefinition =
        parseAuctionDefinition(body) ?? undefined;

      if (!requestedDefinition) {
        return NextResponse.json(
          { outcome: "invalid_request" },
          { status: 400 },
        );
      }
      if (body.startsAt !== undefined) {
        if (typeof body.startsAt !== "string") {
          return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
        }
        requestedStartsAt = new Date(body.startsAt);
        if (
          !Number.isFinite(requestedStartsAt.getTime()) ||
          requestedStartsAt.getTime() <= Date.now()
        ) {
          return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
        }
      }
    }
  } catch {
    return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
  }

  try {
    const currentConfig = await readAuctionConfig();
    const [currentWinner, currentOrder] = await Promise.all([
      readAuctionWinner(currentConfig.runId),
      readAuctionOrder(currentConfig.runId),
    ]);

    if (currentOrder) await saveAuctionOrder(currentOrder);

    if (!currentWinner) {
      const currentState = getTimedAuctionState(Date.now(), currentConfig);
      if (currentState.status !== "ended") {
        return NextResponse.json(
          { outcome: "auction_in_progress" },
          { status: 409 },
        );
      }
    }

    if (currentWinner?.paymentStatus === "pending") {
      const expiresAt = pendingPaymentExpiresAt(currentWinner);
      if (!Number.isFinite(expiresAt) || expiresAt > Date.now()) {
        return NextResponse.json({ outcome: "pending_payment" }, { status: 409 });
      }

      if (currentWinner.paymentSessionId) {
        if (!isPaymentProviderConfigured()) {
          return NextResponse.json(
            { outcome: "pending_payment_recovery_unavailable" },
            { status: 409 },
          );
        }

        const session = await retrievePaymentSession(
          currentWinner.paymentSessionId,
        );
        if (session.payment_status === "paid" || session.status === "complete") {
          return NextResponse.json(
            { outcome: "pending_payment_reconciliation" },
            { status: 409 },
          );
        }
        if (session.status === "open") {
          const expired = await expirePaymentSession(
            currentWinner.paymentSessionId,
          );
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
        currentWinner.bidderId,
        currentWinner.paymentSessionId,
        undefined,
        currentWinner.claimedAt,
      );
      if (released !== 1 && await readAuctionWinner(currentConfig.runId)) {
        return NextResponse.json(
          { outcome: "auction_changed" },
          { status: 409 },
        );
      }
    }

    const startsAt = requestedStartsAt ?? new Date(Date.now() + START_DELAY_MS);
    const definition =
      requestedDefinition ?? auctionDefinitionFromConfig(currentConfig);
    const config: AuctionConfig = {
      schemaVersion: 2,
      runId: randomUUID(),
      startsAt: startsAt.toISOString(),
      ...definition,
    };

    const writeResult = await writeAuctionConfigIfCurrent(
      currentConfig.runId,
      config,
    );

    if (writeResult === 0) {
      return NextResponse.json(
        { outcome: "auction_changed" },
        { status: 409 },
      );
    }

    if (writeResult !== 1) {
      return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
    }

    return NextResponse.json({
      outcome: "scheduled",
      runId: config.runId,
      startsAt: config.startsAt,
      endsAt: getAuctionEndsAt(config).toISOString(),
      productName: config.productName,
      productImageUrl: config.productImageUrl,
      regularPrice: config.regularPrice,
      startPrice: config.startPrice,
      floorPrice: config.floorPrice,
      durationMinutes: config.durationMinutes,
    });
  } catch (error) {
    console.error("Unable to schedule auction in Redis.", error);
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}
