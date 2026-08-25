import { NextResponse } from "next/server";
import { reconcileAuctionLifecycleBatch } from "../../../../lib/auction-lifecycle";
import { processMessageOutbox } from "../../../../lib/message-outbox";
import { errorDetails, logEvent } from "../../../../lib/observability";

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
    logEvent("operations_cron_completed", {
      lifecycleProcessed: lifecycle.processed,
      lifecycleChanged: lifecycle.changed,
      lifecycleRecoveryRequired: lifecycle.recoveryRequired,
      lifecycleErrors: lifecycle.errors,
      messagesProcessed: messages.processed,
      messagesDelivered: messages.delivered,
      messagesRetried: messages.retried,
      messagesDead: messages.dead,
      durationMs: Date.now() - startedAt,
    }, outcome === "completed" ? "info" : "warning");
    return NextResponse.json({
      outcome,
      lifecycle,
      messages,
      hasMoreAuctions: Boolean(cursor),
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    logEvent("operations_cron_failed", errorDetails(error), "error");
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}
