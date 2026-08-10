import { NextRequest, NextResponse } from "next/server";
import {
  grantAuctionEntry,
  readAuctionConfig,
  readAuctionEntry,
  type AuctionEntry,
} from "../../../../lib/auction-storage";

export const dynamic = "force-dynamic";

const ENTRY_FEE = 5;

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

  try {
    const config = await readAuctionConfig();
    const grantedAt = new Date().toISOString();
    const entry: AuctionEntry = {
      bidderId,
      fee: ENTRY_FEE,
      grantedAt,
    };

    await grantAuctionEntry(config.runId, entry);

    return NextResponse.json({
      outcome: "granted",
      runId: config.runId,
      hasEntry: true,
      entryFee: ENTRY_FEE,
      grantedAt,
    });
  } catch (error) {
    console.error("Unable to grant auction entry in Redis.", error);
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}
