import {
  ENTRY_FEE,
  LEGACY_AUCTION_ID,
  type AuctionConfig,
  type AuctionRecord,
  type PublicAuction,
  defaultAuctionConfig,
  getAuctionEndsAt,
  getTimedAuctionState,
  legacyAuctionRecord,
  normalizeAuctionId,
} from "./auction";
import {
  type AuctionWinner,
  auctionConfigKey,
  auctionRecordKey,
  listAuctionIds,
  parseStoredAuctionConfig,
  parseStoredAuctionRecord,
  winnerKey,
} from "./auction-storage";
import {
  type AuctionOrder,
  orderKey,
} from "./order-storage";
import { redisCommand } from "./redis";

export type AdminAuctionView = {
  record: AuctionRecord;
  auction: PublicAuction | null;
};

type AuctionBase = {
  auctionId: string;
  record: AuctionRecord | null;
  config: AuctionConfig | null;
};

type AuctionRuntime = {
  winner: AuctionWinner | null;
  order: AuctionOrder | null;
};

function parseStoredJson<T>(raw: unknown): T | null {
  if (typeof raw !== "string" || !raw) return null;

  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function readAuctionBases(auctionIdValues: string[]) {
  const auctionIds = auctionIdValues
    .map((auctionId) => normalizeAuctionId(auctionId))
    .filter((auctionId): auctionId is string => Boolean(auctionId));
  if (auctionIds.length === 0) return [];

  // Redis REST budget: one MGET for every record/config pair, independent of page size.
  const keys = auctionIds.flatMap((auctionId) => [
    auctionRecordKey(auctionId),
    auctionConfigKey(auctionId),
  ]);
  const values =
    (await redisCommand<Array<string | null>>(["MGET", ...keys])) ?? [];

  return auctionIds.map((auctionId, index): AuctionBase => {
    const recordRaw = values[index * 2];
    const configRaw = values[index * 2 + 1];
    let config = parseStoredAuctionConfig(configRaw);
    let record = parseStoredAuctionRecord(recordRaw);

    if (auctionId === LEGACY_AUCTION_ID) {
      if (configRaw === null || configRaw === undefined) {
        config = defaultAuctionConfig();
      }
      if ((recordRaw === null || recordRaw === undefined) && config) {
        record = legacyAuctionRecord(config);
      }
    }

    return { auctionId, record, config };
  });
}

async function readAuctionRuntimes(bases: AuctionBase[]) {
  if (bases.length === 0) return [];

  // Redis REST budget: one second MGET for all mutable winner/order pairs.
  const keys = bases.flatMap(({ auctionId, config }) => [
    winnerKey(config!.runId, auctionId),
    orderKey(config!.runId, auctionId),
  ]);
  const values =
    (await redisCommand<Array<string | null>>(["MGET", ...keys])) ?? [];

  return bases.map((_, index): AuctionRuntime => ({
    winner: parseStoredJson<AuctionWinner>(values[index * 2]),
    order: parseStoredJson<AuctionOrder>(values[index * 2 + 1]),
  }));
}

function assertConsistentActiveRun(base: AuctionBase) {
  if (
    base.auctionId !== LEGACY_AUCTION_ID &&
    base.record?.currentRunId &&
    base.config &&
    base.record.currentRunId !== base.config.runId
  ) {
    throw new Error("Auction record and active run are inconsistent.");
  }
}

function toPublicAuction(
  base: AuctionBase,
  runtime: AuctionRuntime,
  now: number,
): PublicAuction {
  const config = base.config!;
  const { winner, order } = runtime;
  const timedState = getTimedAuctionState(now, config);
  const status: PublicAuction["status"] = order
    ? "sold"
    : winner
      ? winner.paymentStatus === "pending"
        ? "payment_pending"
        : "sold"
      : timedState.status;

  return {
    auctionId: base.auctionId,
    runId: config.runId,
    product: config.productName,
    productImageUrl: config.productImageUrl,
    category: config.category,
    postAuctionOffer: config.postAuctionOffer,
    regularPrice: config.regularPrice,
    startPrice: config.startPrice,
    floorPrice: config.floorPrice,
    durationMinutes: config.durationMinutes,
    currentPrice: order?.amount ?? winner?.price ?? timedState.currentPrice,
    entryFee: ENTRY_FEE,
    status,
    startsAt: config.startsAt,
    endsAt: getAuctionEndsAt(config).toISOString(),
    soldAt:
      order?.paidAt ??
      (winner && winner.paymentStatus !== "pending"
        ? winner.paidAt ?? winner.claimedAt
        : null),
    paymentExpiresAt:
      !order && winner?.paymentStatus === "pending"
        ? winner.paymentExpiresAt ?? null
        : null,
    storageReady: true,
    serverTime: new Date(now).toISOString(),
  };
}

async function hydratePublicAuctions(
  bases: AuctionBase[],
  options: { includeUnpublished?: boolean; now: number },
) {
  const candidates = bases.filter((base) => {
    if (!base.record) return false;
    if (!options.includeUnpublished && base.record.state !== "published") {
      return false;
    }
    if (!base.config) return false;
    assertConsistentActiveRun(base);
    return true;
  });
  const runtimes = await readAuctionRuntimes(candidates);

  return candidates.map((base, index) => ({
    auctionId: base.auctionId,
    auction: toPublicAuction(base, runtimes[index], options.now),
  }));
}

export async function readPublicAuction(
  auctionIdValue: string,
  options: { includeUnpublished?: boolean; now?: number } = {},
): Promise<PublicAuction | null> {
  const auctionId = normalizeAuctionId(auctionIdValue);
  if (!auctionId) return null;

  const bases = await readAuctionBases([auctionId]);
  const hydrated = await hydratePublicAuctions(bases, {
    includeUnpublished: options.includeUnpublished,
    now: options.now ?? Date.now(),
  });
  return hydrated[0]?.auction ?? null;
}

export async function listPublicAuctions(input: {
  cursor?: string | null;
  limit?: number;
}) {
  const page = await listAuctionIds({
    cursor: input.cursor,
    limit: input.limit,
    catalogOnly: true,
  });
  if (!page) return null;

  const bases = await readAuctionBases(page.auctionIds);
  const hydrated = await hydratePublicAuctions(bases, { now: Date.now() });

  return {
    auctions: hydrated.map(({ auction }) => auction),
    nextCursor: page.nextCursor,
  };
}

export async function readAdminAuction(auctionIdValue: string) {
  const auctionId = normalizeAuctionId(auctionIdValue);
  if (!auctionId) return null;

  const bases = await readAuctionBases([auctionId]);
  const base = bases[0];
  if (!base?.record) return null;

  const hydrated = await hydratePublicAuctions(bases, {
    includeUnpublished: true,
    now: Date.now(),
  });
  return {
    record: base.record,
    auction: hydrated[0]?.auction ?? null,
  } satisfies AdminAuctionView;
}

export async function listAdminAuctions(input: {
  cursor?: string | null;
  limit?: number;
}) {
  const page = await listAuctionIds({
    cursor: input.cursor,
    limit: input.limit,
    catalogOnly: false,
  });
  if (!page) return null;

  const bases = (await readAuctionBases(page.auctionIds)).filter(
    (base): base is AuctionBase & { record: AuctionRecord } =>
      Boolean(base.record),
  );
  const hydrated = await hydratePublicAuctions(bases, {
    includeUnpublished: true,
    now: Date.now(),
  });
  const publicByAuctionId = new Map(
    hydrated.map(({ auctionId, auction }) => [auctionId, auction]),
  );
  const auctions = bases.map(({ auctionId, record }) => ({
    record,
    auction: publicByAuctionId.get(auctionId) ?? null,
  })) satisfies AdminAuctionView[];

  return { auctions, nextCursor: page.nextCursor };
}
