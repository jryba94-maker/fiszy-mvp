import type { NextRequest } from "next/server";
import { redisCommand } from "./redis";
import { rateLimitFingerprint } from "./rate-limit-identity";

const WINDOW_SECONDS = 10 * 60;
const IP_LIMIT = 30;
const BIDDER_LIMIT = 6;

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
  const ipKey = `fiszy:${environment}:rate:v1:entry:ip:${rateLimitFingerprint("entry.ip", `${scope}\0${clientAddress(request)}`, 24)}`;
  const bidderKey = `fiszy:${environment}:rate:v1:entry:bidder:${rateLimitFingerprint("entry.bidder", `${scope}\0${bidderId}`, 24)}`;
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
