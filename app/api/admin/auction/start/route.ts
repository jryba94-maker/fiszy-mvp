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
import { expireCheckoutSession } from "../../../../../lib/stripe";
import {
  hasValidAdminRequest,
  isAdminConfigured,
  isSameOriginAdminMutation,
} from "../../../../../lib/admin-auth";

export const dynamic = "force-dynamic";

const START_DELAY_MS = 60_000;

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
  if (!isSameOriginAdminMutation(request)) {
    return NextResponse.json({ outcome: "invalid_origin" }, { status: 403 });
  }

  let requestedDefinition: AuctionDefinition | undefined;

  try {
    const rawBody = await request.text();
    if (rawBody.trim()) {
      requestedDefinition =
        parseAuctionDefinition(JSON.parse(rawBody) as unknown) ?? undefined;

      if (!requestedDefinition) {
        return NextResponse.json(
          { outcome: "invalid_request" },
          { status: 400 },
        );
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
      if (!currentWinner.paymentSessionId || !process.env.STRIPE_SECRET_KEY) {
        return NextResponse.json({ outcome: "pending_payment" }, { status: 409 });
      }

      try {
        await expireCheckoutSession(currentWinner.paymentSessionId);
      } catch (error) {
        console.error("Unable to expire previous winner Checkout Session.", error);
        return NextResponse.json({ outcome: "pending_payment" }, { status: 409 });
      }

      await releaseAuctionWinner(
        currentConfig.runId,
        currentWinner.bidderId,
        currentWinner.paymentSessionId,
        undefined,
        currentWinner.claimedAt,
      );
    }

    const startsAt = new Date(Date.now() + START_DELAY_MS);
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
