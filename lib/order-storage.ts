import { AUCTION_ID } from "./auction";
import { redisCommand } from "./redis";

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

function latestOrderKey() {
  return `fiszy:${environmentName()}:auction:${AUCTION_ID}:order:latest`;
}

export function orderKey(runId: string) {
  return `fiszy:${environmentName()}:auction:${AUCTION_ID}:run:${runId}:order`;
}

export async function saveAuctionOrder(order: AuctionOrder) {
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

if created then return 1 end
return 0
`;

  return redisCommand<number>([
    "EVAL",
    script,
    2,
    orderKey(order.runId),
    latestOrderKey(),
    JSON.stringify(order),
  ]);
}

export async function readAuctionOrder(runId: string): Promise<AuctionOrder | null> {
  const raw = await redisCommand<string>(["GET", orderKey(runId)]);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as AuctionOrder;
  } catch {
    return null;
  }
}

export async function readLatestAuctionOrder(): Promise<AuctionOrder | null> {
  const raw = await redisCommand<string>(["GET", latestOrderKey()]);
  if (!raw) return null;

  try {
    const pointer = JSON.parse(raw) as { runId?: unknown; paidAt?: unknown };
    if (
      typeof pointer.runId !== "string" ||
      !pointer.runId ||
      pointer.runId.length > 120 ||
      typeof pointer.paidAt !== "string" ||
      !Number.isFinite(new Date(pointer.paidAt).getTime())
    ) {
      return null;
    }

    return readAuctionOrder(pointer.runId);
  } catch {
    return null;
  }
}
