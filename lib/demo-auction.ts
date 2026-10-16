export const DEMO_TURN_MS = 120_000;
export type DemoBuyer = { id: string; price: number; clickedAt: number; claimedAt: number | null };
export type DemoAuctionState = { startedAt: number; now: number; buyers: DemoBuyer[]; outcome: "won" | "lost" | null; soldPrice: number | null; joined: boolean; nextBotAt: number; sequence: number };
export type DemoAction = { type: "tick"; now: number } | { type: "join"; now: number } | { type: "pay"; now: number; code: string } | { type: "skip"; now: number };
export function demoPrice(startPrice: number, elapsedMs: number) {
  return Math.max(Math.round(startPrice * .2), startPrice - Math.floor(Math.max(0, elapsedMs) / 5000) * Math.round(startPrice * .08));
}
export function newDemoAuction(now: number): DemoAuctionState {
  return { startedAt: now + 5000, now, buyers: [], outcome: null, soldPrice: null, joined: false, nextBotAt: now + 13000, sequence: 0 };
}
export function demoAuctionStep(state: DemoAuctionState, action: DemoAction, startPrice: number): DemoAuctionState {
  if (state.outcome) return state;
  let next = { ...state, now: action.now, buyers: state.buyers.map(b => ({ ...b })) };
  const head = next.buyers[0];
  if (head?.claimedAt != null && action.now >= head.claimedAt + DEMO_TURN_MS) {
    next.buyers.shift();
    if (head.id === "you") return { ...next, outcome: "lost", soldPrice: head.price };
    if (next.buyers[0]) next.buyers[0].claimedAt = action.now;
  }
  if (action.type === "tick" && action.now >= next.nextBotAt && action.now >= next.startedAt && next.buyers.length < 5) {
    next.sequence++;
    next.buyers.push({ id: `demo-${next.sequence}`, price: demoPrice(startPrice, action.now - next.startedAt), clickedAt: action.now, claimedAt: next.buyers.length ? null : action.now });
    next.nextBotAt = action.now + 12000;
  }
  if (action.type === "join" && !next.joined && action.now >= next.startedAt) {
    next.buyers.push({ id: "you", price: demoPrice(startPrice, action.now - next.startedAt), clickedAt: action.now, claimedAt: next.buyers.length ? null : action.now });
    next.joined = true;
  }
  if (action.type === "skip" && next.buyers[0]?.id !== "you" && next.buyers.length) {
    next.buyers.shift();
    if (next.buyers[0]) next.buyers[0].claimedAt = action.now;
  }
  if (action.type === "pay" && /^[0-9]{6}$/.test(action.code) && next.buyers[0]?.id === "you") {
    return { ...next, outcome: "won", soldPrice: next.buyers[0].price };
  }
  return next;
}
