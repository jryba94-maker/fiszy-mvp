import { accountIdFromParticipantId, readClerkAccountEmail } from "../../../../../../../../lib/account-email";
import { NextRequest, NextResponse } from "next/server";
import {
  normalizeAuctionId,
  normalizeRunId,
} from "../../../../../../../../lib/auction";
import {
  listRunParticipants,
  readAuctionRecord,
  readAuctionRunConfig,
  readAuctionRunHistoryOutcomes,
} from "../../../../../../../../lib/auction-storage";
import {
  hasAdminPermission,
  hasValidAdminRequest,
  isAdminConfigured,
} from "../../../../../../../../lib/admin-auth";
import {
  errorDetails,
  logEvent,
} from "../../../../../../../../lib/observability";

export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ auctionId: string; runId: string }>;
};

export async function GET(request: NextRequest, context: Context) {
  if (!isAdminConfigured()) {
    return NextResponse.json(
      { outcome: "admin_not_configured" },
      { status: 503 },
    );
  }
  if (!hasValidAdminRequest(request)) {
    return NextResponse.json({ outcome: "unauthorized" }, { status: 401 });
  }

  const params = await context.params;
  const auctionId = normalizeAuctionId(params.auctionId);
  const runId = normalizeRunId(params.runId);
  const cursor = request.nextUrl.searchParams.get("cursor");
  const limitValue = request.nextUrl.searchParams.get("limit");
  const limit = limitValue === null ? 20 : Number(limitValue);
  if (
    !auctionId ||
    !runId ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 50
  ) {
    return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
  }

  try {
    const [record, config] = await Promise.all([
      readAuctionRecord(auctionId),
      readAuctionRunConfig(runId, auctionId),
    ]);
    if (!record || !config) {
      return NextResponse.json({ outcome: "not_found" }, { status: 404 });
    }

    const [page, outcomes] = await Promise.all([
      listRunParticipants({ auctionId, runId, cursor, limit }),
      readAuctionRunHistoryOutcomes([runId], auctionId),
    ]);
    if (!page) {
      return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
    }

    const outcome = outcomes[0];
    if (!outcome) throw new Error("Auction run history outcome is missing.");
    const { winner, order } = outcome;
    const winnerId = winner?.bidderId ?? order?.bidderId ?? null;
    const canReadEmails = hasAdminPermission(request, "users:read");
    const participants = await Promise.all(page.participants.map(async (participant) => {
      const accountId = canReadEmails ? accountIdFromParticipantId(participant.participantId) : null;
      const email = accountId ? await readClerkAccountEmail(accountId).catch(() => null) : null;
      return {
        email,
        participantId: participant.participantId,
        entryStatus: outcome.cancelledAt && participant.entryStatus === "granted" && participant.entryFee > 0 ? "refund_required" : participant.entryStatus,
        fee: participant.entryFee,
        paymentReference: participant.entryPaymentReference ?? (participant.entryPaymentSessionId || null),
        grantedAt: participant.grantedAt ?? null,
        refundedAt: participant.refundedAt ?? null,
        isWinner: participant.participantId === winnerId,
      };
    }));

    return NextResponse.json(
      {
        outcome: "ok",
        auctionId,
        runId,
        participants,
        total: page.total,
        nextCursor: page.nextCursor,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (caught) {
    logEvent(
      "admin_auction_run_participant_list_failed",
      { auctionId, runId, ...errorDetails(caught) },
      "error",
    );
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}
