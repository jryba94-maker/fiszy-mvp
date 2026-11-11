import { NextResponse } from "next/server";
import { processDueCampaign } from "../../../../lib/email-campaigns";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ outcome: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await processDueCampaign();
    return NextResponse.json({ outcome: "ok", processed: Boolean(result) });
  } catch {
    console.error("Scheduled email campaign processing failed.");
    return NextResponse.json({ outcome: "campaign_processing_failed" }, { status: 503 });
  }
}
