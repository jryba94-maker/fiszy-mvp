import { NextRequest, NextResponse } from "next/server";
import { AUCTION_ID, getTimedAuctionState } from "../../../../lib/auction";
import {
  readAuctionConfig,
  readAuctionEntry,
  readAuctionWinner,
} from "../../../../lib/auction-storage";
import { getCheckoutOrigin } from "../../../../lib/request-origin";
import { createEntryCheckoutSession } from "../../../../lib/stripe";

export const dynamic = "force-dynamic";

const ENTRY_FEE = 5;
const ENTRY_FEE_GROSZE = ENTRY_FEE * 100;

type EntryRequest = {
  bidderId?: string;
};

function normalizeBidderId(value?: string | null) {
  const bidderId = value?.trim();
  if (!bidderId || bidderId.length > 100) return null;
  return bidderId;
}

export async function GET(request: NextRequest) {
  const bidderId = normalizeBidderId(request.nextUrl.searchParams.get("bidderId"));

  if (!bidderId) {
    return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
  }

  try {
    const config = await readAuctionConfig();
    const entry = await readAuctionEntry(config.runId, bidderId);

    return NextResponse.json({
      outcome: "ok",
      runId: config.runId,
      hasEntry: Boolean(entry),
      entryFee: ENTRY_FEE,
      grantedAt: entry?.grantedAt ?? null,
    });
  } catch (error) {
    console.error("Unable to read auction entry from Redis.", error);
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  let body: EntryRequest;

  try {
    body = (await request.json()) as EntryRequest;
  } catch {
    return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
  }

  const bidderId = normalizeBidderId(body.bidderId);

  if (!bidderId) {
    return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json({ outcome: "stripe_not_configured" }, { status: 503 });
  }

  try {
    const config = await readAuctionConfig();
    const existingEntry = await readAuctionEntry(config.runId, bidderId);

    if (existingEntry) {
      return NextResponse.json({
        outcome: "already_granted",
        runId: config.runId,
        hasEntry: true,
        entryFee: ENTRY_FEE,
      });
    }

    const winner = await readAuctionWinner(config.runId);
    const timedState = getTimedAuctionState(Date.now(), config);

    if (winner || timedState.status === "ended") {
      return NextResponse.json(
        {
          outcome: "auction_unavailable",
          runId: config.runId,
        },
        { status: 409 },
      );
    }

    const session = await createEntryCheckoutSession({
      origin: getCheckoutOrigin(request),
      auctionId: AUCTION_ID,
      runId: config.runId,
      bidderId,
      amount: ENTRY_FEE_GROSZE,
      productName: config.productName,
    });

    return NextResponse.json({
      outcome: "checkout",
      runId: config.runId,
      checkoutUrl: session.url,
      entryFee: ENTRY_FEE,
    });
  } catch (error) {
    console.error("Unable to create Stripe Checkout Session.", error);
    return NextResponse.json({ outcome: "payment_error" }, { status: 503 });
  }
}
