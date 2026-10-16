import { normalizedAutopayPayment } from "../../../../../lib/autopay-settlement";
import { NextRequest, NextResponse } from "next/server";
import { autopayAcknowledgement, autopayConfiguration, verifyAutopayTransactions } from "../../../../../lib/payment-providers/autopay-protocol";
import { claimAutopayPaidRemote, expireAutopaySession, refundAutopayPayment } from "../../../../../lib/payment-providers/autopay";
import { readAutopayIntent, updateAutopayIntent, type AutopayIntent } from "../../../../../lib/autopay-storage";
import { handlePaidEntry, handlePaidPurchase, handlePaidDiscountPurchase, handleExpiredPurchase, handleExpiredDiscountPurchase, type SettlementSession } from "../../../../../lib/checkout-settlement";
import { errorDetails, logEvent } from "../../../../../lib/observability";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  if (!autopayConfiguration().credentialsConfigured) return NextResponse.json({ outcome: "webhook_not_configured" }, { status: 503 });
  let transactions;
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 180000) throw new Error("ITN too large.");
    const body = await request.text();
    if (body.length > 180000) throw new Error("ITN too large.");
    const fields = new URLSearchParams(body);
    if (fields.getAll("transactions").length !== 1) throw new Error("Invalid ITN body.");
    const encoded = fields.get("transactions")!;
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error("Invalid ITN encoding.");
    transactions = verifyAutopayTransactions(Buffer.from(encoded, "base64").toString("utf8"));
  } catch {
    return NextResponse.json({ outcome: "invalid_notification" }, { status: 400 });
  }
  try {
    for (const tx of transactions) {
      const reference = `ap_${tx.orderID}`;
      const intent = await readAutopayIntent(reference);
      if (!intent || tx.amount !== (intent.amount / 100).toFixed(2) || tx.gatewayID !== autopayConfiguration().gatewayId) throw new Error("Autopay notification does not match a registered payment.");
      const payment = normalizedAutopayPayment(intent);
      if (tx.paymentStatus === "PENDING") {
        await updateAutopayIntent(reference, { status: "processing" });
      } else if (tx.paymentStatus === "SUCCESS") {
        const firstRemote = await claimAutopayPaidRemote(reference, tx.remoteID);
        if (firstRemote !== tx.remoteID) { await refundAutopayPayment(reference, tx.remoteID); continue; }
        if (intent.kind === "auction_entry") {
          if (!await handlePaidEntry(payment)) await refundAutopayPayment(reference, tx.remoteID);
        }
        else if (intent.kind === "auction_purchase") {
          if (!await handlePaidPurchase(payment)) await refundAutopayPayment(reference, tx.remoteID);
        } else if (!await handlePaidDiscountPurchase(payment)) await refundAutopayPayment(reference, tx.remoteID);
      } else {
        await updateAutopayIntent(reference, { failureNotified: true });
        // One failed RemoteID never overrides another pending/successful attempt.
        const final = await expireAutopaySession(reference);
        if (final.state === "expired") {
          if (intent.kind === "auction_purchase") await handleExpiredPurchase(payment);
          if (intent.kind === "post_auction_purchase") await handleExpiredDiscountPurchase(payment);
        }
      }
    }
    return new NextResponse(autopayAcknowledgement(transactions), { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store" } });
  } catch (error) {
    logEvent("autopay_itn_processing_failed", errorDetails(error), "error");
    return NextResponse.json({ outcome: "notification_retry_required" }, { status: 503 });
  }
}
