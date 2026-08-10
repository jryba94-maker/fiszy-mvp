import { NextResponse } from "next/server";

const START_PRICE = 749;
const FLOOR_PRICE = 699;
const DROP_INTERVAL_MS = 2000;
const PRICE_STEPS = START_PRICE - FLOOR_PRICE + 1;
const CYCLE_MS = PRICE_STEPS * DROP_INTERVAL_MS;

export const dynamic = "force-dynamic";

export async function GET() {
  const now = Date.now();
  const elapsedInCycle = now % CYCLE_MS;
  const completedSteps = Math.floor(elapsedInCycle / DROP_INTERVAL_MS);
  const currentPrice = Math.max(FLOOR_PRICE, START_PRICE - completedSteps);

  return NextResponse.json(
    {
      auctionId: "demo-airpods-pro-1",
      product: "AirPods Pro",
      regularPrice: 999,
      currentPrice,
      entryFee: 5,
      status: "live",
      serverTime: new Date(now).toISOString(),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
