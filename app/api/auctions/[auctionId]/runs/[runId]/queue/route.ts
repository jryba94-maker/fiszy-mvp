import { NextRequest } from "next/server";
import { handleQueueGet } from "../../../../_shared/operations";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest, context: { params: Promise<{ auctionId: string; runId: string }> }) {
  const { auctionId, runId } = await context.params;
  return handleQueueGet(request, auctionId, runId);
}
