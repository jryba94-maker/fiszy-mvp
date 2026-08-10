import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const environment = process.env.VERCEL_ENV ?? "unknown";
  const adminSecretConfigured = Boolean(process.env.FISZY_ADMIN_SECRET);
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const stripeConfigured = Boolean(stripeSecretKey);
  const stripeTestMode = stripeSecretKey?.startsWith("sk_test_") ?? false;
  const stripeWebhookConfigured = Boolean(process.env.STRIPE_WEBHOOK_SECRET);
  const redisUrl =
    process.env.STORAGE_KV_REST_API_URL ||
    process.env.KV_REST_API_URL ||
    process.env.UPSTASH_REDIS_REST_URL;
  const redisUrlConfigured = Boolean(redisUrl);
  const redisTokenConfigured = Boolean(
    process.env.STORAGE_KV_REST_API_TOKEN ||
      process.env.KV_REST_API_TOKEN ||
      process.env.UPSTASH_REDIS_REST_TOKEN,
  );
  const expectedRaceTestRedisHash =
    process.env.FISZY_RACE_TEST_REDIS_URL_SHA256?.trim().toLowerCase();
  const actualRedisHash = redisUrl
    ? createHash("sha256").update(redisUrl).digest("hex")
    : null;
  const raceTestStorageReady =
    environment === "development" &&
    Boolean(expectedRaceTestRedisHash) &&
    expectedRaceTestRedisHash === actualRedisHash;

  return NextResponse.json(
    {
      environment,
      adminSecretConfigured,
      redisConfigured: redisUrlConfigured && redisTokenConfigured,
      stripeConfigured,
      stripeTestMode,
      stripeWebhookConfigured,
      raceTestStorageReady,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
