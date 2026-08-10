import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  type AuctionConfig,
  getAuctionEndsAt,
} from "../../../../../lib/auction";
import {
  readAuctionConfig,
  readAuctionWinner,
  releaseAuctionWinner,
  writeAuctionConfig,
} from "../../../../../lib/auction-storage";
import { expireCheckoutSession } from "../../../../../lib/stripe";

export const dynamic = "force-dynamic";

const START_DELAY_MS = 60_000;

function hasValidAdminKey(request: NextRequest) {
  const configuredKey = process.env.FISZY_ADMIN_SECRET;
  if (!configuredKey) return false;

  const authorization = request.headers.get("authorization") ?? "";
  return authorization === `Bearer ${configuredKey}`;
}

export async function POST(request: NextRequest) {
  if (!process.env.FISZY_ADMIN_SECRET) {
    return NextResponse.json(
      { outcome: "admin_not_configured" },
      { status: 503 },
    );
  }

  if (!hasValidAdminKey(request)) {
    return NextResponse.json({ outcome: "unauthorized" }, { status: 401 });
  }

  try {
    const currentConfig = await readAuctionConfig();
    const currentWinner = await readAuctionWinner(currentConfig.runId);

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
      );
    }

    const startsAt = new Date(Date.now() + START_DELAY_MS);
    const config: AuctionConfig = {
      runId: randomUUID(),
      startsAt: startsAt.toISOString(),
    };

    await writeAuctionConfig(config);

    return NextResponse.json({
      outcome: "scheduled",
      runId: config.runId,
      startsAt: config.startsAt,
      endsAt: getAuctionEndsAt(config.startsAt).toISOString(),
    });
  } catch (error) {
    console.error("Unable to schedule auction in Redis.", error);
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}
