import { NextRequest } from "next/server";
import {
  handleEntryGet,
  handleEntryPost,
} from "../../../../_shared/operations";

export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ auctionId: string; runId: string }>;
};

export async function GET(request: NextRequest, context: Context) {
  const { auctionId, runId } = await context.params;
  return handleEntryGet(request, auctionId, runId);
}

export async function POST(request: NextRequest, context: Context) {
  const { auctionId, runId } = await context.params;
  return handleEntryPost(request, auctionId, runId);
}
