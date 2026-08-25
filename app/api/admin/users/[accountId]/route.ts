import { NextRequest, NextResponse } from "next/server";
import {
  hasAdminPermission,
  isAdminConfigured,
  isSameOriginAdminMutation,
} from "../../../../../lib/admin-auth";
import { recordSuccessfulAdminAudit } from "../../../../../lib/admin-audit";
import { listParticipantHistory } from "../../../../../lib/auction-storage";
import {
  readAccountProfile,
  readAccountAdminRecord,
  updateAccountAdminRecord,
} from "../../../../../lib/portal-storage";
import { logEvent } from "../../../../../lib/observability";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ accountId: string }> },
) {
  if (!isAdminConfigured()) return NextResponse.json({ outcome: "admin_not_configured" }, { status: 503 });
  if (!hasAdminPermission(request, "users:read")) return NextResponse.json({ outcome: "forbidden" }, { status: 403 });
  const { accountId } = await context.params;
  try {
    const [profile, administration, history] = await Promise.all([
      readAccountProfile(accountId),
      readAccountAdminRecord(accountId),
      listParticipantHistory({ participantId: `clerk:${accountId}`, limit: 30 }),
    ]);
    if (!profile) return NextResponse.json({ outcome: "not_found" }, { status: 404 });
    return NextResponse.json({
      outcome: "ok",
      profile,
      administration,
      activity: (history?.items ?? []).map(({ participant, config, winner, order }) => ({
        auctionId: participant.auctionId,
        runId: participant.runId,
        product: config.productName,
        enteredAt: participant.grantedAt ?? participant.refundedAt,
        entryStatus: participant.entryStatus,
        isWinner: winner?.bidderId === participant.participantId,
        winnerPrice: winner?.bidderId === participant.participantId ? winner.price : null,
        order: order?.bidderId === participant.participantId
          ? { orderId: order.orderId, amount: order.amount, paidAt: order.paidAt }
          : null,
      })),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Unable to read portal user.", error);
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ accountId: string }> },
) {
  if (!isAdminConfigured()) return NextResponse.json({ outcome: "admin_not_configured" }, { status: 503 });
  if (!hasAdminPermission(request, "users:write")) return NextResponse.json({ outcome: "forbidden" }, { status: 403 });
  if (!isSameOriginAdminMutation(request)) return NextResponse.json({ outcome: "invalid_origin" }, { status: 403 });
  const { accountId } = await context.params;
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ outcome: "invalid_request" }, { status: 400 }); }
  const candidate = body && typeof body === "object" ? body as Record<string, unknown> : null;
  const expectedRevision = candidate?.expectedRevision;
  const status = candidate?.status;
  const internalNote = candidate?.internalNote;
  if (!Number.isInteger(expectedRevision) || (status !== "active" && status !== "blocked") || (internalNote !== null && typeof internalNote !== "string")) {
    return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
  }
  try {
    const previous = await readAccountAdminRecord(accountId);
    const administration = await updateAccountAdminRecord({ accountId, expectedRevision: Number(expectedRevision), status, internalNote });
    if (!administration) return NextResponse.json({ outcome: "revision_conflict" }, { status: 409 });
    await recordSuccessfulAdminAudit(request, {
      action: "account.access.updated",
      resourceType: "account",
      resourceId: accountId,
      details: {
        previousStatus: previous.status,
        status: administration.status,
        noteChanged: previous.internalNote !== administration.internalNote,
        revision: administration.revision,
      },
    });
    logEvent("admin_user_updated", { accountRef: accountId.slice(0, 12), status });
    return NextResponse.json({ outcome: "ok", administration });
  } catch (error) {
    console.error("Unable to update portal user.", error);
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}
