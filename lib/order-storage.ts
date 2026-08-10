import {
  AUCTION_ID,
  LEGACY_AUCTION_ID,
  normalizeAuctionId,
  normalizeRunId,
} from "./auction";
import { redisCommand } from "./redis";
import { winnerKey } from "./auction-storage";

export type OrderAddress = {
  city: string | null;
  country: string | null;
  line1: string | null;
  line2: string | null;
  postalCode: string | null;
  state: string | null;
};

export type AuctionOrder = {
  orderId: string;
  auctionId: string;
  runId: string;
  bidderId: string;
  product: string;
  amount: number;
  currency: "pln";
  paymentSessionId: string;
  paidAt: string;
  customer: {
    name: string | null;
    email: string | null;
    phone: string | null;
  };
  shippingAddress: OrderAddress | null;
};

function environmentName() {
  return process.env.VERCEL_ENV ?? "local";
}

function prefix() {
  return `fiszy:${environmentName()}`;
}

function checkedAuctionId(value: string) {
  const auctionId = normalizeAuctionId(value);
  if (!auctionId) throw new Error("Invalid auction id.");
  return auctionId;
}

function checkedRunId(value: string) {
  const runId = normalizeRunId(value);
  if (!runId) throw new Error("Invalid auction run id.");
  return runId;
}

function latestOrderKey(auctionId: string = AUCTION_ID) {
  return `${prefix()}:auction:${checkedAuctionId(auctionId)}:order:latest`;
}

function ordersIndexKey() {
  return `${prefix()}:index:v1:orders`;
}

function orderReferenceKey(orderId: string) {
  return `${prefix()}:order-ref:${encodeURIComponent(orderId)}`;
}

function orderReference(auctionId: string, runId: string) {
  return `${checkedAuctionId(auctionId)}|${checkedRunId(runId)}`;
}

export function orderKey(runId: string, auctionId: string = AUCTION_ID) {
  return `${prefix()}:auction:${checkedAuctionId(auctionId)}:run:${checkedRunId(runId)}:order`;
}

export async function saveAuctionOrder(order: AuctionOrder) {
  const auctionId = checkedAuctionId(order.auctionId);
  const runId = checkedRunId(order.runId);
  const reference = orderReference(auctionId, runId);
  const paidAtMs = new Date(order.paidAt).getTime();
  if (!Number.isFinite(paidAtMs)) throw new Error("Invalid order paidAt.");

  const script = `
local created = redis.call("SET", KEYS[1], ARGV[1], "NX")
local canonicalRaw = redis.call("GET", KEYS[1])
if not canonicalRaw then return -1 end

local orderOk, canonical = pcall(cjson.decode, canonicalRaw)
if not orderOk or type(canonical) ~= "table" or not canonical.runId or not canonical.paidAt then
  return -1
end

local latestRaw = redis.call("GET", KEYS[2])
local shouldUpdate = not latestRaw

if latestRaw then
  local latestOk, latest = pcall(cjson.decode, latestRaw)
  if not latestOk or type(latest) ~= "table" or not latest.runId or not latest.paidAt then
    shouldUpdate = true
  elseif latest.runId == canonical.runId or canonical.paidAt > latest.paidAt then
    shouldUpdate = true
  end
end

if shouldUpdate then
  redis.call("SET", KEYS[2], cjson.encode({ runId = canonical.runId, paidAt = canonical.paidAt }))
end

redis.call("ZADD", KEYS[3], ARGV[2], ARGV[3])
redis.call("SET", KEYS[4], ARGV[3], "NX")

if created then return 1 end
return 0
`;

  return redisCommand<number>([
    "EVAL",
    script,
    4,
    orderKey(runId, auctionId),
    latestOrderKey(auctionId),
    ordersIndexKey(),
    orderReferenceKey(order.orderId),
    JSON.stringify(order),
    paidAtMs,
    reference,
  ]);
}

export async function savePaidAuctionOrder(order: AuctionOrder) {
  const auctionId = checkedAuctionId(order.auctionId);
  const runId = checkedRunId(order.runId);
  const reference = orderReference(auctionId, runId);
  const paidAtMs = new Date(order.paidAt).getTime();
  if (!Number.isFinite(paidAtMs)) throw new Error("Invalid order paidAt.");

  const script = `
local winnerRaw = redis.call("GET", KEYS[5])
if not winnerRaw then return -2 end
local winnerOk, winner = pcall(cjson.decode, winnerRaw)
if not winnerOk or type(winner) ~= "table" then return -2 end
if winner.bidderId ~= ARGV[4] or winner.paymentSessionId ~= ARGV[5] then return -2 end
if winner.paymentStatus ~= "pending" and winner.paymentStatus ~= "paid" then return -2 end

local created = redis.call("SET", KEYS[1], ARGV[1], "NX")
local canonicalRaw = redis.call("GET", KEYS[1])
if not canonicalRaw then return -1 end
local orderOk, canonical = pcall(cjson.decode, canonicalRaw)
if not orderOk or type(canonical) ~= "table" then return -1 end
if canonical.bidderId ~= ARGV[4] or canonical.paymentSessionId ~= ARGV[5] then return -1 end

if winner.paymentStatus == "pending" then
  winner.paymentStatus = "paid"
  winner.paidAt = canonical.paidAt
  redis.call("SET", KEYS[5], cjson.encode(winner), "EX", 604800)
end

local latestRaw = redis.call("GET", KEYS[2])
local shouldUpdate = not latestRaw
if latestRaw then
  local latestOk, latest = pcall(cjson.decode, latestRaw)
  if not latestOk or type(latest) ~= "table" or not latest.runId or not latest.paidAt then
    shouldUpdate = true
  elseif latest.runId == canonical.runId or canonical.paidAt > latest.paidAt then
    shouldUpdate = true
  end
end
if shouldUpdate then
  redis.call("SET", KEYS[2], cjson.encode({ runId = canonical.runId, paidAt = canonical.paidAt }))
end

redis.call("ZADD", KEYS[3], ARGV[2], ARGV[3])
redis.call("SET", KEYS[4], ARGV[3], "NX")
if created then return 1 end
return 0
`;

  return redisCommand<number>([
    "EVAL",
    script,
    5,
    orderKey(runId, auctionId),
    latestOrderKey(auctionId),
    ordersIndexKey(),
    orderReferenceKey(order.orderId),
    winnerKey(runId, auctionId),
    JSON.stringify(order),
    paidAtMs,
    reference,
    order.bidderId,
    order.paymentSessionId,
  ]);
}

export async function readAuctionOrder(
  runId: string,
  auctionId: string = AUCTION_ID,
): Promise<AuctionOrder | null> {
  const raw = await redisCommand<string>([
    "GET",
    orderKey(runId, auctionId),
  ]);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as AuctionOrder;
  } catch {
    return null;
  }
}

export async function readLatestAuctionOrder(
  auctionId: string = AUCTION_ID,
): Promise<AuctionOrder | null> {
  const raw = await redisCommand<string>([
    "GET",
    latestOrderKey(auctionId),
  ]);
  if (!raw) return null;

  try {
    const pointer = JSON.parse(raw) as { runId?: unknown; paidAt?: unknown };
    if (
      typeof pointer.runId !== "string" ||
      !normalizeRunId(pointer.runId) ||
      typeof pointer.paidAt !== "string" ||
      !Number.isFinite(new Date(pointer.paidAt).getTime())
    ) {
      return null;
    }

    return readAuctionOrder(pointer.runId, auctionId);
  } catch {
    return null;
  }
}

export async function ensureLegacyOrderIndexed() {
  const order = await readLatestAuctionOrder(LEGACY_AUCTION_ID);
  if (order) await saveAuctionOrder(order);
}

export async function listAuctionOrders(input: {
  cursor?: string | null;
  limit?: number;
}) {
  const cursor = input.cursor ?? "0";
  if (!/^\d+$/.test(cursor)) return null;
  const offset = Number(cursor);
  const limit = input.limit ?? 20;
  if (!Number.isSafeInteger(offset) || limit < 1 || limit > 50) return null;

  await ensureLegacyOrderIndexed();
  const [references, total] = await Promise.all([
    redisCommand<string[]>([
      "ZREVRANGE",
      ordersIndexKey(),
      offset,
      offset + limit - 1,
    ]),
    redisCommand<number>(["ZCARD", ordersIndexKey()]),
  ]);

  const parsed = (references ?? []).map((reference) => {
    const [auctionId, runId, extra] = reference.split("|");
    if (extra || !normalizeAuctionId(auctionId) || !normalizeRunId(runId)) {
      return null;
    }
    return { auctionId, runId };
  });

  const validReferences = parsed.filter(
    (reference): reference is { auctionId: string; runId: string } =>
      Boolean(reference),
  );
  const orders = (
    await Promise.all(
      validReferences.map(({ auctionId, runId }) =>
        readAuctionOrder(runId, auctionId),
      ),
    )
  ).filter((order): order is AuctionOrder => Boolean(order));

  const nextOffset = offset + (references?.length ?? 0);
  return {
    orders,
    nextCursor: nextOffset < (total ?? 0) ? String(nextOffset) : null,
  };
}

export async function readLatestGlobalAuctionOrder() {
  const page = await listAuctionOrders({ limit: 1 });
  return page?.orders[0] ?? null;
}
