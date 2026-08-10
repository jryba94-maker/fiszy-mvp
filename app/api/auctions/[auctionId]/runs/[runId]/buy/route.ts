import { NextRequest } from "next/server";
import { handleBuyPost } from "../../../../_shared/operations";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ auctionId: string; runId: string }> },
) {
  const { auctionId, runId } = await context.params;
  return handleBuyPost(request, auctionId, runId);
}
