import test from "node:test";
import assert from "node:assert/strict";
import { createCoalescedRead } from "../lib/coalesced-read.ts";
import { readPublicAuctionForPolling } from "../lib/auction-view.ts";

test("150 concurrent public reads share one in-flight load; errors retry and keys stay isolated", async () => {
  const cache = createCoalescedRead(10, 2);
  let calls = 0;
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  const load = async () => { calls++; await wait; return 42; };
  const readers = Array.from({ length: 150 }, () => cache("one", load));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(calls, 1, "slow in-flight reads must not expire before completion");
  release();
  assert.ok((await Promise.all(readers)).every(value => value === 42));
  await cache("another", async () => 8);
  assert.equal(await cache("one", load), 42);
  await assert.rejects(cache("failed", async () => { throw Error("offline"); }), /offline/);
  assert.equal(await cache("failed", async () => 9), 9);
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(await cache("one", async () => 77), 77);
});

test("public polling coalesces 150 snapshots but computes fresh server time and never exposes checkout", async () => {
  const previousFetch = globalThis.fetch;
  const previousEnv = { ...process.env };
  Object.assign(process.env, { VERCEL_ENV: "development", STORAGE_KV_REST_API_URL: "http://public-cache.invalid", STORAGE_KV_REST_API_TOKEN: "test" });
  const auctionId = "performance-public-fixture";
  const now = Date.now();
  const config = { schemaVersion: 2, runId: "fixture-run", startsAt: new Date(now-1000).toISOString(), productName: "Fixture", productImageUrl: null, entryFee: 5, regularPrice: 999, startPrice: 999, floorPrice: 5, durationMinutes: 10 };
  const record = { schemaVersion: 1, auctionId, state: "published", currentRunId: config.runId, revision: 1, createdAt: config.startsAt, updatedAt: config.startsAt, ...config };
  let reads = 0;
  globalThis.fetch = async (_url, init) => {
    const command = JSON.parse(init.body);
    assert.equal(command[0], "MGET");
    reads++;
    await new Promise(resolve => setTimeout(resolve, 5));
    if (command[1].endsWith(":record")) return Response.json({ result: [JSON.stringify(record), JSON.stringify(config)] });
    return Response.json({ result: [JSON.stringify({ bidderId: "private", price: 990, claimedAt: new Date(now).toISOString(), paymentStatus: "pending", paymentCheckoutUrl: "https://private-checkout.invalid" }), null] });
  };
  try {
    const results = await Promise.all(Array.from({ length: 150 }, () => readPublicAuctionForPolling(auctionId)));
    assert.ok(results.every(value => value?.status === "live"));
    assert.equal(reads, 2, "one bases MGET plus one runtime MGET for the whole burst");
    assert.ok(results.every(value => !JSON.stringify(value).includes("private")));
    await new Promise(resolve => setTimeout(resolve, 10));
    const later = await readPublicAuctionForPolling(auctionId);
    assert.ok(Date.parse(later.serverTime) > Date.parse(results[0].serverTime));
    assert.equal(reads, 2);
  } finally {
    globalThis.fetch = previousFetch;
    for (const key of ["VERCEL_ENV", "STORAGE_KV_REST_API_URL", "STORAGE_KV_REST_API_TOKEN"]) {
      if (previousEnv[key] === undefined) delete process.env[key]; else process.env[key] = previousEnv[key];
    }
  }
});
