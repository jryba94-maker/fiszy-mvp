import type { AuctionWinner } from "./auction-storage";
import { readAuctionWinner, winnerKey } from "./auction-storage";
import { advanceAuctionQueue, purchaseDeadline } from "./auction-queue";
import { redisCommand } from "./redis";
import { errorDetails, logEvent } from "./observability";

// Runs inside Next after(), not in the browser. This is an additional bounded
// reconciliation trigger; Autopay enforces the financial deadline independently.
// Polling/ITN remain recovery paths if the function is restarted during its wait.
export async function reconcileAuctionTurnDeadline(
  auctionId: string,
  runId: string,
  winner: AuctionWinner,
  wait: (milliseconds: number) => Promise<void> = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
) {
  const deadline = purchaseDeadline(winner);
  if (!Number.isFinite(deadline)) return;
  const key = `${winnerKey(runId, auctionId)}:deadline:${encodeURIComponent(winner.claimedAt)}:${encodeURIComponent(winner.bidderId)}`;
  if (await redisCommand(["SET", key, "scheduled", "NX", "PX", 180000]) !== "OK") return;
  try {
    await wait(Math.max(0, deadline - Date.now()));
    const current = await readAuctionWinner(runId, auctionId);
    if (!current || current.bidderId !== winner.bidderId || current.claimedAt !== winner.claimedAt || current.paymentStatus !== "pending") return;
    await advanceAuctionQueue(auctionId, runId);
  } catch (error) {
    logEvent("auction_turn_deadline_recovery_required", { auctionId, runId, ...errorDetails(error) }, "error");
  }
}
