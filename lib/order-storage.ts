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

export async function saveAuctionOrder(order: AuctionOrder) {
  return redisCommand<string>([
    "SET",
    orderKey(order.runId),
    JSON.stringify(order),
    "NX",
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
