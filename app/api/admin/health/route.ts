import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  configuredAdminRole,
  hasValidAdminRequest,
  isAdminConfigured,
  isAdminSecretStrong,
} from "../../../../lib/admin-auth";
import { redisCommand } from "../../../../lib/redis";
import { logEvent } from "../../../../lib/observability";
import { paymentProviderHealth } from "../../../../lib/payment-provider";
import { checkoutOriginConfiguration } from "../../../../lib/request-origin";
import { siteUrl } from "../../../../lib/site";

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
  const payment = paymentProviderHealth(environment);
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
  const authenticationConfigured = Boolean(
    process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
  );
  const emailDeliveryConfigured = Boolean(
    process.env.RESEND_API_KEY && process.env.FISZY_EMAIL_FROM,
  );

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
    payment.configured &&
    payment.modeMatchesEnvironment &&
    payment.webhookConfigured &&
    checkoutOrigin.productionReady &&
    isAdminSecretStrong() &&
    authenticationConfigured;

  if (!healthy) {
    logEvent(
      "admin_health_degraded",
      {
        environment,
        redisReachable,
        paymentProvider: payment.provider,
        paymentConfigured: payment.configured,
        paymentWebhookConfigured: payment.webhookConfigured,
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
      adminRole: configuredAdminRole(),
      authenticationProvider: "clerk",
      authenticationConfigured,
      emailDeliveryConfigured,
      inAppNotificationsConfigured: true,
      externalErrorAlertsConfigured: Boolean(process.env.SENTRY_DSN),
      canonicalSiteUrl: siteUrl(),
      canonicalSiteUrlExplicit: Boolean(process.env.NEXT_PUBLIC_SITE_URL),
      redisConfigured: Boolean(redisUrl && redisTokenConfigured),
      redisReachable,
      redisLatencyMs,
      paymentProvider: payment.provider,
      paymentConfigured: payment.configured,
      paymentTestMode: payment.testMode,
      paymentLiveMode: payment.liveMode,
      paymentModeMatchesEnvironment: payment.modeMatchesEnvironment,
      paymentWebhookConfigured: payment.webhookConfigured,
      // Legacy aliases stay during the Stripe-to-provider-neutral migration.
      stripeConfigured: payment.configured,
      stripeTestMode: payment.testMode,
      stripeLiveMode: payment.liveMode,
      stripeModeMatchesEnvironment: payment.modeMatchesEnvironment,
      stripeWebhookConfigured: payment.webhookConfigured,
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
