import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { claimAuctionWinnerIfCurrent } from "../lib/auction-storage.ts";

function parseEnv(text) {
  return Object.fromEntries(text.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) return [];
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    return [[match[1], value]];
  }));
}

const local = parseEnv(await readFile(".env.local", "utf8").catch(() => ""));
const development = parseEnv(await readFile(".env.development.local", "utf8").catch(() => ""));
const settings = { ...local, ...development };
if (settings.VERCEL_ENV !== "development") throw new Error("Test is locked to Development.");
const redisUrl = settings.STORAGE_KV_REST_API_URL || settings.KV_REST_API_URL || settings.UPSTASH_REDIS_REST_URL;
const redisToken = settings.STORAGE_KV_REST_API_TOKEN || settings.KV_REST_API_TOKEN || settings.UPSTASH_REDIS_REST_TOKEN;
const expectedHash = settings.FISZY_RACE_TEST_REDIS_URL_SHA256?.toLowerCase();
if (!redisUrl || !redisToken || !expectedHash || createHash("sha256").update(redisUrl).digest("hex") !== expectedHash) throw new Error("Development Redis fingerprint mismatch.");
Object.assign(process.env, settings);

async function redis(command) {
  const response = await fetch(redisUrl, { method: "POST", headers: { Authorization: `Bearer ${redisToken}`, "Content-Type": "application/json" }, body: JSON.stringify(command), signal: AbortSignal.timeout(8_000) });
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error("Development Redis command failed.");
  return payload.result;
}

const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const auctionId = `concurrency-${suffix}`;
const runId = `run-${suffix}`;
const bidders = [`bidder-a-${suffix}`, `bidder-b-${suffix}`];
const prefix = `fiszy:development:auction:${auctionId}`;
const configKey = `${prefix}:config`;
const winnerKey = `${prefix}:run:${runId}:winner`;
const entryKeys = bidders.map((bidder) => `${prefix}:run:${runId}:entry:${encodeURIComponent(bidder)}`);
const now = Date.now();
try {
  await redis(["SET", configKey, JSON.stringify({ schemaVersion: 2, runId, startsAt: new Date(now - 1000).toISOString(), productName: "Concurrency fixture", productImageUrl: "/fixture.png", category: "other", postAuctionOffer: { enabled: true, validityDays: 1, inventory: null }, entryFee: 5, regularPrice: 100, startPrice: 100, floorPrice: 1, durationMinutes: 10 }), "EX", 300]);
  await Promise.all(entryKeys.map((key, index) => redis(["SET", key, JSON.stringify({ bidderId: bidders[index], fee: 5, grantedAt: new Date(now).toISOString() }), "EX", 300])));
  const results = await Promise.all(bidders.map((bidder, index) => claimAuctionWinnerIfCurrent(runId, bidder, now - 1000, now + 60_000, now, { bidderId: bidder, price: 95, claimedAt: new Date(now + index).toISOString(), paymentStatus: "pending" }, auctionId)));
  if (results.filter((value) => value === 1).length !== 1 || results.filter((value) => value === 0).length !== 1) throw new Error(`Atomic claim failed: ${results.join(",")}`);
  const winner = JSON.parse(await redis(["GET", winnerKey]));
  if (!bidders.includes(winner.bidderId)) throw new Error("Stored winner is invalid.");
  console.log(JSON.stringify({ outcome: "pass", contenders: 2, winners: 1 }));
} finally {
  await redis(["DEL", configKey, winnerKey, ...entryKeys]);
}
