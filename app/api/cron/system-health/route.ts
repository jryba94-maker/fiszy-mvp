import { NextResponse } from "next/server";
import { logEvent, errorDetails } from "../../../../lib/observability";
import { paymentProviderHealth } from "../../../../lib/payment-provider";
import { redisCommand } from "../../../../lib/redis";
import { siteUrl } from "../../../../lib/site";
import {
  sendSystemAlert,
  systemAlertsConfigured,
  transactionalEmailConfigured,
} from "../../../../lib/transactional-email";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET?.trim();
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ outcome: "unauthorized" }, { status: 401 });
  }

  const checkedAt = new Date().toISOString();
  const issues: string[] = [];
  try {
    if ((await redisCommand<string>(["PING"])) !== "PONG") issues.push("redis.unreachable");
  } catch {
    issues.push("redis.unreachable");
  }

  const payment = paymentProviderHealth("production");
  if (!payment.configured) issues.push("payments.not_configured");
  if (!payment.modeMatchesEnvironment) issues.push("payments.mode_mismatch");
  if (!payment.webhookConfigured) issues.push("payments.webhook_missing");
  if (!process.env.CLERK_SECRET_KEY || !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    issues.push("authentication.not_configured");
  }
  if (!transactionalEmailConfigured()) issues.push("email.not_configured");
  if (siteUrl() !== "https://fiszy.pl") issues.push("domain.canonical_mismatch");

  if (issues.length) {
    try {
      await sendSystemAlert(issues, checkedAt);
    } catch (error) {
      logEvent("system_health.alert_failed", errorDetails(error), "error");
      return NextResponse.json({ outcome: "alert_failed", issueCount: issues.length }, { status: 503 });
    }
    logEvent("system_health.degraded", { issueCount: issues.length }, "warning");
    return NextResponse.json({ outcome: "alert_sent", issueCount: issues.length });
  }

  logEvent("system_health.ready");
  return NextResponse.json({ outcome: "ready", alertsConfigured: systemAlertsConfigured() });
}
