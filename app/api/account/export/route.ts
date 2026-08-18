import { NextResponse } from "next/server";
import { currentAccountIdentity } from "../../../../lib/account-auth";
import { listParticipantHistory } from "../../../../lib/auction-storage";
import {
  ensureAccountProfile,
  listAccountTickets,
  listWatchedAuctionIds,
} from "../../../../lib/portal-storage";

export const dynamic = "force-dynamic";

export async function GET() {
  const identity = await currentAccountIdentity();
  if (!identity) return NextResponse.json({ outcome: "unauthorized" }, { status: 401 });
  try {
    const [profile, history, tickets, watchedAuctionIds] = await Promise.all([
      ensureAccountProfile(identity.accountId),
      listParticipantHistory({ participantId: identity.participantId, limit: 50 }),
      listAccountTickets({ accountId: identity.accountId, limit: 50 }),
      listWatchedAuctionIds(identity.accountId),
    ]);
    const exportedAt = new Date().toISOString();
    const exportBody = {
      schemaVersion: 1,
      exportedAt,
      profile,
      watchedAuctionIds,
      auctionHistory: history?.items ?? [],
      supportTickets: tickets?.tickets ?? [],
      notes: [
        "Eksport nie zawiera sekretów logowania ani danych płatniczych operatora.",
        "Historia finansowa może być przechowywana dłużej, jeżeli wymagają tego przepisy.",
      ],
    };
    return new NextResponse(JSON.stringify(exportBody, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="fiszy-export-${exportedAt.slice(0, 10)}.json"`,
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
  } catch (error) {
    console.error("Unable to export account data.", error);
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}
