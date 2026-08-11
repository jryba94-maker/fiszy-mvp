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

export function orderKey(runId: string) {
  return `fiszy:${environmentName()}:auction:${AUCTION_ID}:run:${runId}:order`;
}

function ordersIndexKey() {
  return `fiszy:${environmentName()}:auction:${AUCTION_ID}:orders`;
}

function orderScore(order: AuctionOrder) {
  const paidAt = new Date(order.paidAt).getTime();
  return Number.isFinite(paidAt) ? paidAt : Date.now();
}

export async function saveAuctionOrder(order: AuctionOrder) {
  const script = `
local existing = redis.call("GET", KEYS[1])
if not existing then
  redis.call("SET", KEYS[1], ARGV[1])
end
redis.call("ZADD", KEYS[2], ARGV[2], ARGV[3])
if existing then return 0 end
return 1
`;

  return redisCommand<number>([
    "EVAL",
    script,
    2,
    orderKey(order.runId),
    ordersIndexKey(),
    JSON.stringify(order),
    orderScore(order),
    order.runId,
  ]);
}

export async function ensureAuctionOrderIndexed(order: AuctionOrder) {
  return redisCommand<number>([
    "ZADD",
    ordersIndexKey(),
    orderScore(order),
    order.runId,
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

export async function readRecentAuctionOrders(limit = 50): Promise<AuctionOrder[]> {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const runIds = await redisCommand<string[]>([
    "ZREVRANGE",
    ordersIndexKey(),
    0,
    safeLimit - 1,
  ]);

  if (!runIds?.length) return [];

  const rawOrders = await redisCommand<Array<string | null>>([
    "MGET",
    ...runIds.map((runId) => orderKey(runId)),
  ]);

  if (!rawOrders) return [];

  const orders: AuctionOrder[] = [];
  for (const raw of rawOrders) {
    if (!raw) continue;
    try {
      orders.push(JSON.parse(raw) as AuctionOrder);
    } catch {
      // Ignore a malformed historical record instead of breaking the admin list.
    }
  }

  return orders;
}
