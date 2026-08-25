import {
  getAuctionEndsAt,
  getTimedAuctionState,
  normalizeAuctionId,
  normalizeRunId,
} from "./auction";
import {
  listAuctionIds,
  readAuctionRecord,
  readAuctionWinner,
  readOptionalAuctionConfig,
} from "./auction-storage";
import { readAuctionOrder } from "./order-storage";
import { redisCommand } from "./redis";

export const AUCTION_LIFECYCLE_STAGES = [
  "draft",
  "entry_open",
  "live",
  "ended",
  "payment_pending",
  "payment_recovery_required",
  "sold",
  "archived",
] as const;

export type AuctionLifecycleStage = (typeof AUCTION_LIFECYCLE_STAGES)[number];

export type AuctionLifecycleCheckpoint = {
  schemaVersion: 1;
  auctionId: string;
  runId: string | null;
  stage: AuctionLifecycleStage;
  startsAt: string | null;
  endsAt: string | null;
  paymentExpiresAt: string | null;
  revision: number;
  observedAt: string;
};

function environmentName() {
  return process.env.VERCEL_ENV ?? "local";
}

function prefix() {
  return `fiszy:${environmentName()}`;
}

function lifecycleKey(auctionId: string) {
  const normalized = normalizeAuctionId(auctionId);
  if (!normalized) throw new Error("Invalid auction id.");
  return `${prefix()}:auction:${normalized}:lifecycle`;
}

function lifecycleIndexKey() {
  return `${prefix()}:index:v1:auction-lifecycle`;
}

function parseCheckpoint(raw: unknown): AuctionLifecycleCheckpoint | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<AuctionLifecycleCheckpoint>;
    const auctionId = normalizeAuctionId(value.auctionId);
    const runId = value.runId === null ? null : normalizeRunId(value.runId);
    if (
      value.schemaVersion !== 1 ||
      !auctionId ||
      (value.runId !== null && !runId) ||
      !AUCTION_LIFECYCLE_STAGES.includes(value.stage as AuctionLifecycleStage) ||
      !Number.isInteger(value.revision) ||
      Number(value.revision) < 1 ||
      typeof value.observedAt !== "string" ||
      !Number.isFinite(Date.parse(value.observedAt)) ||
      (value.startsAt !== null &&
        (typeof value.startsAt !== "string" || !Number.isFinite(Date.parse(value.startsAt)))) ||
      (value.endsAt !== null &&
        (typeof value.endsAt !== "string" || !Number.isFinite(Date.parse(value.endsAt)))) ||
      (value.paymentExpiresAt !== null &&
        (typeof value.paymentExpiresAt !== "string" ||
          !Number.isFinite(Date.parse(value.paymentExpiresAt))))
    ) return null;
    return {
      schemaVersion: 1,
      auctionId,
      runId,
      stage: value.stage as AuctionLifecycleStage,
      startsAt: value.startsAt ?? null,
      endsAt: value.endsAt ?? null,
      paymentExpiresAt: value.paymentExpiresAt ?? null,
      revision: Number(value.revision),
      observedAt: value.observedAt,
    };
  } catch {
    return null;
  }
}

export async function readAuctionLifecycleCheckpoint(auctionId: string) {
  const normalized = normalizeAuctionId(auctionId);
  if (!normalized) return null;
  const checkpoint = parseCheckpoint(
    await redisCommand<string>(["GET", lifecycleKey(normalized)]),
  );
  return checkpoint?.auctionId === normalized ? checkpoint : null;
}

export async function reconcileAuctionLifecycle(
  auctionIdValue: string,
  now = Date.now(),
) {
  const auctionId = normalizeAuctionId(auctionIdValue);
  if (!auctionId) return null;
  const [record, config] = await Promise.all([
    readAuctionRecord(auctionId),
    readOptionalAuctionConfig(auctionId),
  ]);
  if (!record) return null;

  let stage: AuctionLifecycleStage = record.state === "archived" ? "archived" : "draft";
  let paymentExpiresAt: string | null = null;
  let endsAt: string | null = null;
  if (config && record.state !== "archived") {
    const [winner, order] = await Promise.all([
      readAuctionWinner(config.runId, auctionId),
      readAuctionOrder(config.runId, auctionId),
    ]);
    endsAt = getAuctionEndsAt(config).toISOString();
    if (order || winner?.paymentStatus === "paid") {
      stage = "sold";
    } else if (winner?.paymentStatus === "pending") {
      paymentExpiresAt = winner.paymentExpiresAt ?? null;
      stage = paymentExpiresAt && Date.parse(paymentExpiresAt) <= now
        ? "payment_recovery_required"
        : "payment_pending";
    } else {
      const timed = getTimedAuctionState(now, config);
      stage = timed.status === "waiting"
        ? "entry_open"
        : timed.status;
    }
  }

  const previous = await readAuctionLifecycleCheckpoint(auctionId);
  const observedAt = new Date(now).toISOString();
  const next: AuctionLifecycleCheckpoint = {
    schemaVersion: 1,
    auctionId,
    runId: config?.runId ?? null,
    stage,
    startsAt: config?.startsAt ?? null,
    endsAt,
    paymentExpiresAt,
    revision: (previous?.revision ?? 0) + 1,
    observedAt,
  };
  if (
    previous &&
    previous.runId === next.runId &&
    previous.stage === next.stage &&
    previous.startsAt === next.startsAt &&
    previous.endsAt === next.endsAt &&
    previous.paymentExpiresAt === next.paymentExpiresAt
  ) {
    return { checkpoint: previous, changed: false };
  }

  const result = await redisCommand<number>([
    "EVAL",
    `
local raw = redis.call("GET", KEYS[1])
if raw then
  local ok, current = pcall(cjson.decode, raw)
  if not ok or type(current) ~= "table" then return -1 end
  if tonumber(ARGV[1]) ~= current.revision then return 0 end
elseif tonumber(ARGV[1]) ~= 0 then
  return 0
end
redis.call("SET", KEYS[1], ARGV[2])
redis.call("ZADD", KEYS[2], ARGV[3], ARGV[4])
return 1
`,
    2,
    lifecycleKey(auctionId),
    lifecycleIndexKey(),
    previous?.revision ?? 0,
    JSON.stringify(next),
    now,
    auctionId,
  ]);
  if (result !== 1) {
    const current = await readAuctionLifecycleCheckpoint(auctionId);
    return current ? { checkpoint: current, changed: false } : null;
  }
  return { checkpoint: next, changed: true };
}

export async function reconcileAuctionLifecycleBatch(input: {
  cursor?: string | null;
  limit?: number;
  now?: number;
}) {
  const page = await listAuctionIds({
    cursor: input.cursor,
    limit: input.limit ?? 20,
    catalogOnly: false,
  });
  if (!page) return null;
  const results = await Promise.allSettled(
    page.auctionIds.map((auctionId) =>
      reconcileAuctionLifecycle(auctionId, input.now ?? Date.now())),
  );
  return {
    processed: results.length,
    changed: results.filter(
      (result) => result.status === "fulfilled" && result.value?.changed,
    ).length,
    recoveryRequired: results.flatMap((result) =>
      result.status === "fulfilled" &&
      result.value?.checkpoint.stage === "payment_recovery_required"
        ? [result.value.checkpoint.auctionId]
        : [],
    ).length,
    errors: results.filter((result) => result.status === "rejected").length,
    nextCursor: page.nextCursor,
  };
}
