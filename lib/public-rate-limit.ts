import { createHmac } from "node:crypto";
import type { NextRequest } from "next/server";
import { redisCommand } from "./redis";

const WINDOW_SECONDS = 10 * 60;
const IP_LIMIT = 30;
const BIDDER_LIMIT = 6;

function digest(value: string) {
  const salt =
    process.env.FISZY_RATE_LIMIT_SECRET ||
    process.env.FISZY_ADMIN_SECRET ||
    // Compatibility fallback until every environment has a dedicated salt.
    process.env.STRIPE_SECRET_KEY ||
    "fiszy-local-rate-limit";
  return createHmac("sha256", salt).update(value).digest("hex").slice(0, 24);
}

function clientAddress(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown";
}

export async function consumeEntryCheckoutRateLimit(
  request: NextRequest,
  auctionId: string,
  runId: string,
  bidderId: string,
) {
  const environment = process.env.VERCEL_ENV ?? "local";
  const scope = `${auctionId}:${runId}`;
  const ipKey = `fiszy:${environment}:rate:v1:entry:ip:${digest(`${scope}:${clientAddress(request)}`)}`;
  const bidderKey = `fiszy:${environment}:rate:v1:entry:bidder:${digest(`${scope}:${bidderId}`)}`;
  const script = `
local ipCount = redis.call("INCR", KEYS[1])
if ipCount == 1 then redis.call("EXPIRE", KEYS[1], ARGV[1]) end
local bidderCount = redis.call("INCR", KEYS[2])
if bidderCount == 1 then redis.call("EXPIRE", KEYS[2], ARGV[1]) end
local ttl = math.max(redis.call("TTL", KEYS[1]), redis.call("TTL", KEYS[2]))
return { ipCount, bidderCount, ttl }
`;
  const result = await redisCommand<number[]>([
    "EVAL",
    script,
    2,
    ipKey,
    bidderKey,
    WINDOW_SECONDS,
  ]);
  const [ipCount = IP_LIMIT + 1, bidderCount = BIDDER_LIMIT + 1, ttl = WINDOW_SECONDS] =
    result ?? [];

  return {
    allowed: ipCount <= IP_LIMIT && bidderCount <= BIDDER_LIMIT,
    retryAfter: Math.max(1, ttl),
  };
}
