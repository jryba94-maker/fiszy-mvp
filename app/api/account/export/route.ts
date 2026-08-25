import { NextResponse } from "next/server";
import { currentAccountIdentity } from "../../../../lib/account-auth";
import { listParticipantHistory } from "../../../../lib/auction-storage";
import {
  ensureAccountProfile,
  listAccountTickets,
  listWatchedAuctionIds,
} from "../../../../lib/portal-storage";
import { listAccountPrivacyRequests, readPrivacyConsents } from "../../../../lib/privacy-storage";
import { listAccountServiceCases } from "../../../../lib/service-case-storage";

export const dynamic = "force-dynamic";

async function collectAllPages<T>(
  loader: (cursor: string | null) => Promise<{ items: T[]; nextCursor: string | null } | null>,
) {
  const items: T[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
    const page = await loader(cursor);
    if (!page) throw new Error("Unable to read complete account export.");
    items.push(...page.items);
    if (!page.nextCursor) return items;
    if (seen.has(page.nextCursor)) throw new Error("Account export pagination loop detected.");
    seen.add(page.nextCursor);
    cursor = page.nextCursor;
  }
  throw new Error("Account export exceeded the safe 5000 item limit.");
}

export async function GET() {
  const identity = await currentAccountIdentity();
  if (!identity) return NextResponse.json({ outcome: "unauthorized" }, { status: 401 });
  try {
    const [profile, auctionHistory, supportTickets, watchedAuctionIds, privacyConsents, privacyRequests, serviceCases] = await Promise.all([
      ensureAccountProfile(identity.accountId),
      collectAllPages(async (cursor) => {
        const page = await listParticipantHistory({ participantId: identity.participantId, cursor, limit: 50 });
        return page ? { items: page.items, nextCursor: page.nextCursor } : null;
      }),
      collectAllPages(async (cursor) => {
        const page = await listAccountTickets({ accountId: identity.accountId, cursor, limit: 50 });
        return page ? { items: page.tickets, nextCursor: page.nextCursor } : null;
      }),
      listWatchedAuctionIds(identity.accountId),
      readPrivacyConsents(identity.accountId),
      collectAllPages(async (cursor) => {
        const page = await listAccountPrivacyRequests({ accountId: identity.accountId, cursor, limit: 50 });
        return page ? { items: page.requests, nextCursor: page.nextCursor } : null;
      }),
      collectAllPages(async (cursor) => {
        const page = await listAccountServiceCases({ accountId: identity.accountId, cursor, limit: 50 });
        return page ? { items: page.cases, nextCursor: page.nextCursor } : null;
      }),
    ]);
    const exportedAt = new Date().toISOString();
    const exportBody = {
      schemaVersion: 1,
      exportedAt,
      profile,
      watchedAuctionIds,
      auctionHistory,
      supportTickets,
      serviceCases,
      privacyConsents,
      privacyRequests,
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
