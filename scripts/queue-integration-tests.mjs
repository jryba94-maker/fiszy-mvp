import assert from "node:assert/strict";
import { createConnection } from "node:net";
import { randomUUID } from "node:crypto";
import { enqueueAuctionPurchase, readAuctionQueueStatus, readAuctionWinner, releaseAuctionWinner, promoteNextAuctionPurchase, attachAuctionWinnerCheckout, auctionConfigKey, entryKey, winnerKey } from "../lib/auction-storage.ts";
import { advanceAuctionQueue } from "../lib/auction-queue.ts";

// Run against an isolated local Redis, executing the actual production Lua.
// QUEUE_TEST_REDIS_PORT=6387 node --loader ./scripts/typescript-loader.mjs scripts/queue-integration-tests.mjs
const port = process.env.QUEUE_TEST_REDIS_PORT;
if (!/^\d+$/.test(port ?? "")) throw new Error("An isolated local Redis port is required.");
function decode(buffer, offset = 0) {
  const end = buffer.indexOf("\r\n", offset);
  if (end < 0) return null;
  const type = String.fromCharCode(buffer[offset]);
  const value = buffer.toString("utf8", offset + 1, end);
  let next = end + 2;
  if (type === "+") return [value, next];
  if (type === "-") throw new Error(value);
  if (type === ":") return [Number(value), next];
  const count = Number(value);
  if (count === -1) return [null, next];
  if (type === "$") return buffer.length < next + count + 2 ? null : [buffer.toString("utf8", next, next + count), next + count + 2];
  if (type !== "*") throw new Error("Invalid Redis response");
  const values = [];
  for (let i = 0; i < count; i++) {
    const item = decode(buffer, next);
    if (!item) return null;
    values.push(item[0]); next = item[1];
  }
  return [values, next];
}
const redis = (args) => new Promise((resolve, reject) => {
  const socket = createConnection({ host: "127.0.0.1", port: Number(port) });
  let data = Buffer.alloc(0);
  socket.setTimeout(5000, () => socket.destroy(new Error("Redis test timeout")));
  socket.on("error", reject);
  socket.on("connect", () => socket.write(`*${args.length}\r\n` + args.map(arg => `$${Buffer.byteLength(String(arg))}\r\n${arg}\r\n`).join("")));
  socket.on("data", chunk => {
    data = Buffer.concat([data, chunk]);
    try { const result = decode(data); if (result) { socket.end(); resolve(result[0]); } }
    catch (error) { socket.destroy(); reject(error); }
  });
});
Object.assign(process.env, { VERCEL_ENV: "development", STORAGE_KV_REST_API_URL: "http://queue-test.invalid", STORAGE_KV_REST_API_TOKEN: "test", STRIPE_SECRET_KEY: "sk_test_queue" });
let providerState = "open";
let expireFails = false;
let expiryCalls = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  if (String(url) === "http://queue-test.invalid") return Response.json({ result: await redis(JSON.parse(init.body)) });
  assert.ok(String(url).startsWith("https://api.stripe.com/v1/checkout/sessions/"));
  if (String(url).endsWith("/expire")) {
    expiryCalls++;
    if (expireFails) return Response.json({ error: { message: "ambiguous payment" } }, { status: 500 });
    providerState = "expired";
  }
  return Response.json({ id: "cs_test_queue", status: providerState === "paid" ? "complete" : providerState, payment_status: providerState === "paid" ? "paid" : "unpaid", url: "https://checkout.stripe.com/test" });
};
const auction = `queue-test-${randomUUID()}`;
const run = "run-test";
const now = Date.now();
const bidders = Array.from({ length: 32 }, (_, i) => `bidder-${i}`);
const enqueue = (bidder, price = 95) => enqueueAuctionPurchase(run, bidder, now - 1000, now + 600000, now, { bidderId: bidder, price, clickedAt: new Date(now).toISOString() }, auction);
const status = (bidder, at = now) => readAuctionQueueStatus(run, bidder, auction, at);
try {
  await redis(["SET", auctionConfigKey(auction), JSON.stringify({ runId: run })]);
  await Promise.all(bidders.map(bidder => redis(["SET", entryKey(run, bidder, auction), "{}"])));
  const results = await Promise.all(bidders.map(bidder => enqueue(bidder)));
  assert.equal(results.filter(x => x === 1).length, 1);
  assert.equal(results.filter(x => x === 2).length, 31);
  const snapshots = await Promise.all(bidders.map(bidder => status(bidder)));
  assert.deepEqual(snapshots.map(x => x.position).sort((a,b) => a-b), Array.from({ length: 32 }, (_, i) => i+1));
  const ordered = bidders.toSorted((a,b) => snapshots[bidders.indexOf(a)].position - snapshots[bidders.indexOf(b)].position);
  assert.equal(Date.parse((await status(ordered[1])).estimatedTurnAt) - now, 120000);
  assert.equal(Date.parse((await status(ordered[2])).estimatedTurnAt) - now, 240000);
  assert.equal(await enqueue(ordered[2], 1), 2);
  assert.equal((await status(ordered[2])).price, 95);
  assert.equal(await enqueue(ordered[0], 1), 1);
  assert.equal((await status(ordered[0])).price, 95);
  assert.equal(await enqueue("unpaid"), -2);
  let head = await readAuctionWinner(run, auction);
  await attachAuctionWinnerCheckout(run, head.bidderId, "cs_test_queue", "https://checkout.stripe.com/test", new Date(now + 120000).toISOString(), auction, head.claimedAt);
  // A concurrent session attachment prevents stale no-session cancellation.
  assert.equal(await releaseAuctionWinner(run, head.bidderId, undefined, auction, head.claimedAt, true), 0);
  assert.equal((await status(ordered[1])).checkoutUrl, null);
  await advanceAuctionQueue(auction, run, now + 119999);
  assert.equal(expiryCalls, 0);
  expireFails = true;
  await advanceAuctionQueue(auction, run, now + 120000);
  assert.equal((await readAuctionWinner(run, auction)).bidderId, ordered[0]);
  expireFails = false;
  providerState = "paid";
  await advanceAuctionQueue(auction, run, now + 120001);
  assert.equal((await readAuctionWinner(run, auction)).bidderId, ordered[0]);
  providerState = "open";
  await Promise.all(Array.from({ length: 12 }, () => advanceAuctionQueue(auction, run, now + 120002)));
  head = await readAuctionWinner(run, auction);
  assert.equal(head.bidderId, ordered[1]);
  assert.equal(head.claimedAt, new Date(now + 120002).toISOString());
  assert.equal((await status(ordered[2])).position, 2);
  assert.equal(await enqueue(ordered[0]), -4);
  assert.equal((await status(ordered[0])).state, "expired");
  // Stale cancellation must never remove the new head.
  assert.equal(await releaseAuctionWinner(run, ordered[0], "cs_test_queue", auction), 0);
  // A new click racing the release/promote gap must give the older queued buyer
  // a fresh two-minute turn, measured from promotion rather than their click.
  assert.equal(await releaseAuctionWinner(run, head.bidderId, undefined, auction, head.claimedAt, true), 1);
  await redis(["SET", entryKey(run, "new-buyer", auction), "{}"]);
  assert.equal(await enqueueAuctionPurchase(run, "new-buyer", now - 1000, now + 600000, now + 200000, { bidderId: "new-buyer", price: 90, clickedAt: new Date(now + 200000).toISOString() }, auction), 2);
  head = await readAuctionWinner(run, auction);
  assert.equal(head.bidderId, ordered[2]);
  assert.equal(head.claimedAt, new Date(now + 200000).toISOString());
  await redis(["SET", winnerKey(run, auction), JSON.stringify({ ...head, paymentStatus: "paid" })]);
  assert.equal(await enqueue(ordered[3]), 0);
  assert.equal(await promoteNextAuctionPurchase(run, auction), null);
  assert.equal((await status(ordered[2])).state, "closed");
  console.log("PASS: 32 concurrent clicks, unique positions, 2/4-minute estimates, fixed prices, duplicates, eligibility, private checkout, expiry, provider ambiguity, payment race, stale cancellation, paid-auction closure.");
} finally {
  const keys = await redis(["KEYS", `fiszy:development:auction:${auction}:*`]);
  if (keys.length) await redis(["DEL", ...keys]);
  globalThis.fetch = originalFetch;
}
