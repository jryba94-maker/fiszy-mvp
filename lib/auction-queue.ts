import { promoteNextAuctionPurchase, readAuctionWinner, releaseAuctionWinner } from "./auction-storage";
import { expirePaymentSession, retrievePaymentSession } from "./payment-provider";

export const PURCHASE_WINDOW_MS = 120_000;

export function purchaseDeadline(winner: { claimedAt: string; paymentExpiresAt?: string }) {
  return winner.paymentExpiresAt ? Date.parse(winner.paymentExpiresAt) : Date.parse(winner.claimedAt) + PURCHASE_WINDOW_MS;
}

// A payment must be definitively closed at the provider before another bidder can pay.
// Exact-claim compare-and-delete makes concurrent polls and webhooks safe.
export async function advanceAuctionQueue(auctionId: string, runId: string, nowMs = Date.now()) {
  const winner = await readAuctionWinner(runId, auctionId);
  if (!winner) {
    await promoteNextAuctionPurchase(runId, auctionId, nowMs);
    return;
  }
  if (winner.paymentStatus !== "pending" || nowMs < purchaseDeadline(winner)) return;
  if (winner.paymentSessionId) {
    let session = await retrievePaymentSession(winner.paymentSessionId);
    if (session.state === "paid" || session.state === "unknown") return;
    if (session.state === "open") {
      try {
        session = await expirePaymentSession(winner.paymentSessionId);
      } catch {
        // A completed payment can win the race against expiry. Fail closed.
        return;
      }
    }
    if (session.state !== "expired") return;
  }
  const released = await releaseAuctionWinner(runId, winner.bidderId, winner.paymentSessionId, auctionId, winner.claimedAt, !winner.paymentSessionId);
  if (released === 1) await promoteNextAuctionPurchase(runId, auctionId, nowMs);
}
