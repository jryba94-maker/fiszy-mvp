import { NextResponse } from "next/server";
import { reconcileAuctionLifecycleBatch } from "../../../../lib/auction-lifecycle";
import { processMessageOutbox } from "../../../../lib/message-outbox";
import { errorDetails, logEvent } from "../../../../lib/observability";
import { sendSystemAlert, systemAlertsConfigured } from "../../../../lib/transactional-email";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ outcome: "unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  try {
    let cursor: string | null = null;
    let pages = 0;
    const lifecycle = { processed: 0, changed: 0, recoveryRequired: 0, errors: 0 };
    do {
      const page = await reconcileAuctionLifecycleBatch({ cursor, limit: 50 });
      if (!page) throw new Error("Lifecycle reconciliation failed.");
      lifecycle.processed += page.processed;
      lifecycle.changed += page.changed;
      lifecycle.recoveryRequired += page.recoveryRequired;
      lifecycle.errors += page.errors;
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages < 20);

    const messages = await processMessageOutbox({ limit: 50 });
    if (!messages) throw new Error("Message outbox processing failed.");
    const outcome = lifecycle.errors || messages.errors ? "completed_with_errors" : "completed";
    const issues = [
      ...(lifecycle.recoveryRequired > 0
        ? [`auctions.payment_recovery_required:${lifecycle.recoveryRequired}`]
        : []),
      ...(lifecycle.errors > 0 ? [`auctions.reconciliation_errors:${lifecycle.errors}`] : []),
      ...(messages.dead > 0 ? [`email.dead_messages:${messages.dead}`] : []),
      ...(messages.errors > 0 ? [`email.processing_errors:${messages.errors}`] : []),
    ];
    let alertSent = false;
    if (issues.length && systemAlertsConfigured()) {
      await sendSystemAlert(issues, new Date().toISOString());
      alertSent = true;
    }
    logEvent("operations_cron_completed", {
      lifecycleProcessed: lifecycle.processed,
      lifecycleChanged: lifecycle.changed,
      lifecycleRecoveryRequired: lifecycle.recoveryRequired,
      lifecycleErrors: lifecycle.errors,
      messagesProcessed: messages.processed,
      messagesDelivered: messages.delivered,
      messagesRetried: messages.retried,
      messagesDead: messages.dead,
      issueCount: issues.length,
      alertSent,
      durationMs: Date.now() - startedAt,
    }, outcome === "completed" ? "info" : "warning");
    return NextResponse.json({
      outcome,
      lifecycle,
      messages,
      issues,
      alertSent,
      hasMoreAuctions: Boolean(cursor),
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    logEvent("operations_cron_failed", errorDetails(error), "error");
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}
