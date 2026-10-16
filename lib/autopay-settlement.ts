import type { AutopayIntent } from "./autopay-storage";
import type { SettlementSession } from "./checkout-settlement";

export function normalizedAutopayPayment(intent: AutopayIntent): SettlementSession {
  return { provider: "autopay", id: intent.reference, mode: "payment", payment_status: "paid", amount_total: intent.amount, currency: "pln", url: intent.checkoutUrl,
    metadata: { kind: intent.kind, auctionId: intent.auctionId, runId: intent.runId, bidderId: intent.bidderId,
      ...(intent.entryConsentId ? { entryConsentId: intent.entryConsentId } : {}),
      ...(intent.discountId ? { discountId: intent.discountId, accountId: intent.accountId!, reservationToken: intent.reservationToken! } : {}) },
    customer_details: intent.customer, collected_information: intent.shipping };
}
