import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  hasValidAdminRequest,
  isAdminConfigured,
  isAdminSecretStrong,
} from "../../../../lib/admin-auth";
import { redisCommand } from "../../../../lib/redis";
import { logEvent } from "../../../../lib/observability";
import { checkoutOriginConfiguration } from "../../../../lib/request-origin";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isAdminConfigured()) {
    return NextResponse.json(
      { outcome: "admin_not_configured" },
      { status: 503 },
    );
  }

  if (!hasValidAdminRequest(request)) {
    return NextResponse.json({ outcome: "unauthorized" }, { status: 401 });
  }

  const environment = process.env.VERCEL_ENV ?? "local";
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const stripeConfigured = Boolean(stripeSecretKey);
  const stripeTestMode = stripeSecretKey?.startsWith("sk_test_") ?? false;
  const stripeLiveMode = stripeSecretKey?.startsWith("sk_live_") ?? false;
  const stripeWebhookConfigured = Boolean(process.env.STRIPE_WEBHOOK_SECRET);
  const stripeModeMatchesEnvironment =
    environment === "production"
      ? stripeConfigured && stripeLiveMode
      : stripeConfigured && stripeTestMode;
  const checkoutOrigin = checkoutOriginConfiguration();
  const redisUrl =
    process.env.STORAGE_KV_REST_API_URL ||
    process.env.KV_REST_API_URL ||
    process.env.UPSTASH_REDIS_REST_URL;
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

  let redisReachable = false;
  let redisLatencyMs: number | null = null;
  if (redisUrl && redisTokenConfigured) {
    const startedAt = Date.now();
    try {
      redisReachable = (await redisCommand<string>(["PING"])) === "PONG";
      redisLatencyMs = Date.now() - startedAt;
    } catch {
      redisLatencyMs = Date.now() - startedAt;
    }
  }

  const healthy =
    redisReachable &&
    stripeConfigured &&
    stripeModeMatchesEnvironment &&
    stripeWebhookConfigured &&
    checkoutOrigin.productionReady &&
    isAdminSecretStrong();

  if (!healthy) {
    logEvent(
      "admin_health_degraded",
      {
        environment,
        redisReachable,
        stripeConfigured,
        stripeWebhookConfigured,
        checkoutOriginReady: checkoutOrigin.productionReady,
      },
      "warning",
    );
  }

  return NextResponse.json(
    {
      outcome: "ok",
      healthy,
      environment,
      adminSecretConfigured: true,
      adminSecretStrong: isAdminSecretStrong(),
      redisConfigured: Boolean(redisUrl && redisTokenConfigured),
      redisReachable,
      redisLatencyMs,
      stripeConfigured,
      stripeTestMode,
      stripeLiveMode,
      stripeModeMatchesEnvironment,
      stripeWebhookConfigured,
      checkoutOriginReady: checkoutOrigin.productionReady,
      checkoutOriginExplicit: Boolean(checkoutOrigin.configuredDefault),
      raceTestStorageReady,
      checkedAt: new Date().toISOString(),
    },
    {
      status: healthy ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
