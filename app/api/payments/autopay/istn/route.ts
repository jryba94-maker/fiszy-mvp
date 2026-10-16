import { NextRequest, NextResponse } from "next/server";
import { autopayAcknowledgement, autopayConfiguration, verifyAutopayTransactions } from "../../../../../lib/payment-providers/autopay-protocol";
import { readAutopayRefund, storeAutopayRefund } from "../../../../../lib/autopay-storage";
import { logEvent, errorDetails } from "../../../../../lib/observability";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  if (!autopayConfiguration().credentialsConfigured) return NextResponse.json({ outcome: "webhook_not_configured" }, { status: 503 });
  let transactions;
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 180000) throw Error("Too large");
    const body = await request.text();
    if (body.length > 180000) throw Error("Too large");
    const fields = new URLSearchParams(body);
    const encoded = fields.get("transactions") ?? "";
    if (fields.getAll("transactions").length !== 1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw Error("Invalid encoding");
    transactions = verifyAutopayTransactions(Buffer.from(encoded, "base64").toString("utf8"), true);
  } catch { return NextResponse.json({ outcome: "invalid_notification" }, { status: 400 }); }
  try {
    for (const tx of transactions) {
      // Ordinary payouts are acknowledged, but cannot mutate refund records.
      if (tx.isRefund !== "true" && tx.isRefund !== "1") continue;
      const refund = await readAutopayRefund(tx.orderOutID);
      if (!refund || refund.remoteId !== tx.remoteID || tx.amount !== (refund.amount / 100).toFixed(2)) throw Error("Refund notification mismatch");
      if (refund.state === "completed") continue;
      if (tx.transferStatus === "SUCCESS" && tx.transferStatusDetails === "CONFIRMED") {
        await storeAutopayRefund({ ...refund, state: "completed", updatedAt: new Date().toISOString() });
      } else if (tx.transferStatus === "FAILURE") {
        await storeAutopayRefund({ ...refund, state: "failed", updatedAt: new Date().toISOString() });
        logEvent("autopay_refund_failed", { messageId: refund.messageId, reference: refund.reference }, "error");
      }
    }
    return new NextResponse(autopayAcknowledgement(transactions, true), { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store" } });
  } catch (error) {
    logEvent("autopay_istn_processing_failed", errorDetails(error), "error");
    return NextResponse.json({ outcome: "notification_retry_required" }, { status: 503 });
  }
}
