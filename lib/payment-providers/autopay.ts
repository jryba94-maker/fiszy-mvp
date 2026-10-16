import { requireAutopayAuctionGateway } from "./autopay-gateway";
import { createHash } from "node:crypto";
import { accountIdFromParticipantId, readClerkAccountEmail } from "../account-email";
import { readAccountProfile } from "../portal-storage";
import { reserveAuctionWinnerPaymentReference } from "../auction-storage";
import { attachDiscountPaymentSession } from "../discount-storage";
import { claimAutopayPaidRemote, readAutopayIntent, reserveAutopayIntent, updateAutopayIntent, autopayRefundId, readAutopayRefund, storeAutopayRefund, type AutopayIntent } from "../autopay-storage";
import { autopayConfiguration, autopayHash, autopayPost, autopayDate, parseAutopayXml, verifyAutopayHash, verifyAutopayTransactions, xmlField, xmlRecord } from "./autopay-protocol";
import type { PaymentSession } from "../payment-provider";

export class AutopayCustomerError extends Error {}

export async function autopayCustomer(bidderId: string, shippingRequired: boolean) {
  const accountId = accountIdFromParticipantId(bidderId);
  if (!accountId) throw new AutopayCustomerError("customer_details_required");
  const [profile, email] = await Promise.all([readAccountProfile(accountId), readClerkAccountEmail(accountId)]);
  if (!email || (shippingRequired && (!profile?.fullName || !profile.phone || !profile.address?.line1 || !profile.address.city || !profile.address.postalCode))) throw new AutopayCustomerError("customer_details_required");
  const address = profile?.address ? { city: profile.address.city, country: "PL", line1: profile.address.line1, line2: profile.address.line2, postal_code: profile.address.postalCode, state: null } : null;
  return { customer: { email, name: profile?.fullName ?? null, phone: profile?.phone ?? null, address },
    shipping: address ? { shipping_details: { name: profile?.fullName ?? "", address } } : null };
}

function session(intent: AutopayIntent, state: PaymentSession["state"]): PaymentSession {
  return { provider: "autopay", reference: intent.reference, checkoutUrl: intent.checkoutUrl, state };
}

type CreateInput = { auctionId: string; runId: string; bidderId: string; amount: number; expiresAt?: number; claimToken?: string; discountId?: string; accountId?: string; reservationToken?: string; entryConsentId?: string };
export async function createAutopaySession(kind: AutopayIntent["kind"], input: CreateInput): Promise<PaymentSession> {
  const config = autopayConfiguration();
  if (!config.credentialsConfigured) throw new Error("Autopay is not configured.");
  const customer = await autopayCustomer(input.bidderId, kind !== "auction_entry");
  const requestedDeadline = input.expiresAt ? input.expiresAt * 1000 : Date.now() + 15 * 60_000;
  // Entry can be sold weeks before start, but its payment link must stay short.
  const deadline = new Date(kind === "auction_entry" ? Math.min(requestedDeadline, Date.now() + 15 * 60_000) : requestedDeadline);
  if (kind === "auction_purchase") {
    if (!input.expiresAt || !input.claimToken || deadline.getTime() > Date.parse(input.claimToken) + 120000) throw Error("Invalid auction payment deadline.");
    await requireAutopayAuctionGateway(input.amount, deadline.getTime());
  }
  const paymentValidUntil = kind === "auction_purchase" ? deadline : new Date(Math.max(deadline.getTime(), Date.now() + 15 * 60_000));
  const reserved = await reserveAutopayIntent({ ...input, ...customer, kind, expiresAt: deadline.toISOString(), paymentValidUntil: paymentValidUntil.toISOString() });
  let intent = reserved.intent;
  if (intent.amount !== input.amount) throw new Error("Autopay amount changed for an existing intent.");
  if (!reserved.created) {
    if (intent.checkoutUrl) return session(intent, intent.status === "paid" ? "paid" : "processing");
    throw new Error("Autopay creation is still being reconciled; do not start another payment.");
  }
  // Bind the local claim before sending anything that could charge the customer.
  if (kind === "auction_purchase") {
    const bound = await reserveAuctionWinnerPaymentReference(input.runId, input.auctionId, input.bidderId, input.claimToken!, intent.reference);
    if (bound !== 1) { await updateAutopayIntent(intent.reference, { status: "failed" }); throw new Error("Purchase claim is no longer current."); }
  } else if (kind === "post_auction_purchase") {
    const bound = await attachDiscountPaymentSession({ discountId: input.discountId!, accountId: input.accountId!, reservationToken: input.reservationToken!, provider: "autopay", reference: intent.reference, checkoutUrl: "" });
    if (bound !== 1) { await updateAutopayIntent(intent.reference, { status: "failed" }); throw new Error("Discount claim is no longer current."); }
  }
  const fields = { ServiceID: config.serviceId, OrderID: intent.orderId, Amount: (input.amount / 100).toFixed(2),
    Description: kind === "auction_entry" ? "Fiszy - dostep do aukcji" : "Fiszy - zakup produktu", GatewayID: config.gatewayId, Currency: "PLN", CustomerEmail: customer.customer.email!,
    ValidityTime: autopayDate(new Date(intent.paymentValidUntil)), LinkValidityTime: autopayDate(deadline) };
  try {
    const root = parseAutopayXml(await autopayPost("", fields, true));
    const tx = xmlRecord(root.transaction);
    const status = xmlField(tx, "status");
    const url = xmlField(tx, "redirecturl");
    const orderId = xmlField(tx, "orderID");
    const remoteId = xmlField(tx, "remoteID");
    verifyAutopayHash([status, url, orderId, remoteId], xmlField(tx, "hash"));
    if (status !== "PENDING" || orderId !== intent.orderId || !/^[A-Za-z0-9]{1,20}$/.test(remoteId) || new URL(url).origin !== config.host) throw new Error("Invalid Autopay continuation.");
    intent = await updateAutopayIntent(intent.reference, { status: "processing", checkoutUrl: url, remoteId });
    return session(intent, "processing");
  } catch (error) {
    // HTTP timeout is ambiguous: provider may already have accepted the payment.
    await updateAutopayIntent(intent.reference, { status: "unknown" });
    throw error;
  }
}

async function readProviderTransactions(intent: AutopayIntent) {
  const config = autopayConfiguration();
  const transactions = verifyAutopayTransactions(await autopayPost("/webapi/transactionStatus", { ServiceID: config.serviceId, OrderID: intent.orderId }));
  if (transactions.some(tx => tx.orderID !== intent.orderId || tx.amount !== (intent.amount / 100).toFixed(2))) throw Error("Autopay status mismatch.");
  return transactions;
}

export async function retrieveAutopaySession(reference: string): Promise<PaymentSession> {
  let intent = await readAutopayIntent(reference);
  if (!intent) throw Error("Autopay intent not found.");
  if (intent.status === "paid") return session(intent, "paid");
  const transactions = await readProviderTransactions(intent);
  // A status query cannot settle a sale; SUCCESS waits for the signed ITN.
  if (transactions.some(tx => tx.paymentStatus === "SUCCESS")) return session(intent, "processing");
  if (transactions.some(tx => tx.paymentStatus === "PENDING")) {
    intent = await updateAutopayIntent(reference, { status: "processing" });
    return session(intent, "processing");
  }
  const closed = intent.cancelConfirmed || (autopayConfiguration().orderReuseBlocked && intent.failureNotified);
  if (closed && transactions.length && transactions.every(tx => tx.paymentStatus === "FAILURE")) {
    intent = await updateAutopayIntent(reference, { status: "failed" });
    return session(intent, "expired");
  }
  return session(intent, "unknown");
}

export async function expireAutopaySession(reference: string): Promise<PaymentSession> {
  let intent = await readAutopayIntent(reference);
  if (!intent) throw Error("Autopay intent not found.");
  if (intent.status === "paid") return session(intent, "paid");
  const before = await readProviderTransactions(intent);
  if (before.some(tx => tx.paymentStatus === "SUCCESS")) return session(intent, "processing");
  if ((intent.cancelConfirmed || (autopayConfiguration().orderReuseBlocked && intent.failureNotified)) && before.length && before.every(tx => tx.paymentStatus === "FAILURE")) {
    intent = await updateAutopayIntent(reference, { status: "failed" });
    return session(intent, "expired");
  }
  // Accepted PENDING payments are actively cancelled at the purchase deadline.
  // Other checkout kinds keep their previous, longer validity behavior.
  if (before.some(tx => tx.paymentStatus === "PENDING") && (intent.kind !== "auction_purchase" || Date.now() < Date.parse(intent.expiresAt))) return session(intent, "processing");
  const config = autopayConfiguration();
  const messageId = createHash("sha256").update(`cancel:${reference}`).digest("hex").slice(0, 32);
  const root = parseAutopayXml(await autopayPost("/webapi/transactionCancel", { ServiceID: config.serviceId, MessageID: messageId, OrderID: intent.orderId }));
  const tx = xmlRecord(root.transaction);
  const fields = [xmlField(tx, "serviceID"), xmlField(tx, "messageID"), xmlField(tx, "confirmation"), xmlField(tx, "reason", false)];
  verifyAutopayHash(fields, xmlField(tx, "hash"));
  if (fields[0] !== config.serviceId || fields[1] !== messageId || fields[2] !== "CONFIRMED" || fields[3] !== "CANCELED_FULLY") return session(intent, "unknown");
  intent = await updateAutopayIntent(reference, { cancelConfirmed: true });
  // Even full cancellation must be followed by a signed status check. A racing
  // SUCCESS, remaining PENDING, empty response or timeout keeps the claim held.
  return retrieveAutopaySession(intent.reference);
}

export async function refundAutopayPayment(reference: string, remoteIdOverride?: string) {
  const intent = await readAutopayIntent(reference);
  const remoteId = remoteIdOverride ?? intent?.paidRemoteId;
  if (!intent || !remoteId) throw new Error("Autopay paid transaction not found.");
  const messageId = autopayRefundId(reference, remoteId);
  const existing = await readAutopayRefund(messageId);
  if (existing?.state === "failed") throw new Error("Autopay refund requires operator review.");
  if (existing?.state === "completed" || existing?.state === "submitted") return { state: existing.state };
  const record = { messageId, reference, remoteId, amount: intent.amount, state: "requested" as const, updatedAt: new Date().toISOString() };
  await storeAutopayRefund(record);
  const config = autopayConfiguration();
  // No amount => full refund; stable MessageID is idempotent after a timeout.
  const fields = { serviceId: Number(config.serviceId), messageId, remoteId };
  const response = await fetch(`${config.host}/settlementapi/transactionRefund/v3`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...fields, hash: autopayHash(Object.values(fields)) }), cache: "no-store", signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error("Autopay refund request failed.");
  const data = await response.json() as { serviceId?: number; messageId?: string; hash?: string };
  verifyAutopayHash([data.serviceId, data.messageId], data.hash);
  if (String(data.serviceId) !== config.serviceId || data.messageId !== messageId) throw new Error("Autopay refund acknowledgement mismatch.");
  await storeAutopayRefund({ ...record, state: "submitted", updatedAt: new Date().toISOString() });
  if ((await readAutopayRefund(messageId))?.state === "failed") throw new Error("Autopay refund failed during submission.");
  return { state: "submitted" as const };
}

export { claimAutopayPaidRemote };
