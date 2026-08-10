import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  type AuctionConfig,
  getAuctionEndsAt,
} from "../../../../../lib/auction";
import { writeAuctionConfig } from "../../../../../lib/auction-storage";

export const dynamic = "force-dynamic";

const START_DELAY_MS = 60_000;

function hasValidAdminKey(request: NextRequest) {
  const configuredKey = process.env.FISZY_ADMIN_KEY;
  if (!configuredKey) return false;

  const authorization = request.headers.get("authorization") ?? "";
  return authorization === `Bearer ${configuredKey}`;
}

export async function POST(request: NextRequest) {
  if (!process.env.FISZY_ADMIN_KEY) {
    return NextResponse.json(
      { outcome: "admin_not_configured" },
      { status: 503 },
    );
  }

  if (!hasValidAdminKey(request)) {
    return NextResponse.json({ outcome: "unauthorized" }, { status: 401 });
  }

  const startsAt = new Date(Date.now() + START_DELAY_MS);
  const config: AuctionConfig = {
    runId: randomUUID(),
    startsAt: startsAt.toISOString(),
  };

  try {
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
