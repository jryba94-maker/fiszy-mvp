import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

const BASE_URL = "http://127.0.0.1:3000";

function parseDotEnv(contents) {
  const values = {};
  for (const line of contents.split(/\r?\n/)) {
    if (/^\s*(?:#|$)/.test(line)) continue;
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

async function optionalFile(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

function first(settings, names) {
  for (const name of names) if (settings[name]) return settings[name];
  throw new Error(`Missing Development setting: ${names.join(", ")}`);
}

async function json(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Expected JSON from ${response.url} (${response.status}).`);
  }
}

async function request(path, init = {}) {
  const response = await fetch(`${BASE_URL}${path}`, init);
  return { response, body: await json(response) };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function run() {
  const settings = {
    ...parseDotEnv(await optionalFile(".env.local")),
    ...parseDotEnv(await optionalFile(".env.development.local")),
  };
  assert(
    settings.VERCEL_ENV === "development",
    "Portal smoke test is locked to VERCEL_ENV=development.",
  );

  const redisUrl = first(settings, [
    "STORAGE_KV_REST_API_URL",
    "KV_REST_API_URL",
    "UPSTASH_REDIS_REST_URL",
  ]);
  const redisToken = first(settings, [
    "STORAGE_KV_REST_API_TOKEN",
    "KV_REST_API_TOKEN",
    "UPSTASH_REDIS_REST_TOKEN",
  ]);
  const adminSecret = first(settings, ["FISZY_ADMIN_SECRET"]);
  const expectedRedisHash = first(settings, [
    "FISZY_RACE_TEST_REDIS_URL_SHA256",
  ]).toLowerCase();
  assert(
    createHash("sha256").update(redisUrl).digest("hex") === expectedRedisHash,
    "Portal smoke test Redis is not the approved Development resource.",
  );

  async function redis(command) {
    const response = await fetch(redisUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${redisToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(command),
    });
    const data = await json(response);
    if (!response.ok || data?.error) {
      throw new Error(`Development Redis command failed (${response.status}).`);
    }
    return data?.result ?? null;
  }

  const publicHealth = await request("/api/health");
  assert(publicHealth.response.ok && publicHealth.body?.status === "ok", "Public health check failed.");

  const beforeSession = await request("/api/admin/session");
  assert(beforeSession.body?.authenticated === false, "Fresh test request unexpectedly had an admin session.");
  const login = await request("/api/admin/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret: adminSecret }),
  });
  assert(login.response.ok && login.body?.authenticated === true, "Admin session login failed.");
  const cookie = login.response.headers.get("set-cookie")?.split(";", 1)[0];
  assert(cookie, "Admin login did not set an HttpOnly session cookie.");
  const adminHeaders = { Cookie: cookie };

  const authenticated = await request("/api/admin/session", { headers: adminHeaders });
  assert(authenticated.body?.authenticated === true, "Admin session cookie was not accepted.");
  const health = await request("/api/admin/health", { headers: adminHeaders });
  assert(
    health.body?.environment === "development" &&
      health.body?.redisReachable === true &&
      health.body?.stripeTestMode === true &&
      health.body?.raceTestStorageReady === true,
    "Admin health is not locked to approved Development services.",
  );

  const baseDefinition = {
    productImageUrl: null,
    regularPrice: 120,
    startPrice: 100,
    floorPrice: 90,
    durationMinutes: 1,
    state: "draft",
  };
  const invalidPrivateImage = await request("/api/admin/auctions", {
    method: "POST",
    headers: { ...adminHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      ...baseDefinition,
      auctionId: `invalid-${randomUUID().slice(0, 8)}`,
      productName: "Invalid private image",
      productImageUrl: "https://127.0.0.1/product.png",
    }),
  });
  assert(invalidPrivateImage.response.status === 400, "Private image URL was not rejected.");

  const invalidFloor = await request("/api/admin/auctions", {
    method: "POST",
    headers: { ...adminHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      ...baseDefinition,
      auctionId: `invalid-${randomUUID().slice(0, 8)}`,
      productName: "Invalid floor",
      regularPrice: 3,
      startPrice: 2,
      floorPrice: 1,
    }),
  });
  assert(invalidFloor.response.status === 400, "One-zloty floor was not rejected.");

  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const auctions = [
    { auctionId: `smoke-alpha-${suffix}`, productName: "Smoke Alpha" },
    { auctionId: `smoke-beta-${suffix}`, productName: "Smoke Beta" },
  ];
  const created = [];
  const scheduled = [];
  const bidders = new Map();
  let completed = false;

  try {
    for (const item of auctions) {
      const result = await request("/api/admin/auctions", {
        method: "POST",
        headers: { ...adminHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ ...baseDefinition, ...item }),
      });
      assert(result.response.status === 201, `Could not create ${item.auctionId}.`);
      assert(result.body?.record?.auctionId === item.auctionId, "Requested auction slug was not preserved.");
      created.push(item.auctionId);
    }

    const duplicate = await request("/api/admin/auctions", {
      method: "POST",
      headers: { ...adminHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ ...baseDefinition, ...auctions[0] }),
    });
    assert(duplicate.response.status === 409, "Duplicate auction slug was not rejected as a conflict.");

    const startsAt = new Date(Date.now() + 4_000).toISOString();
    for (const item of auctions) {
      const result = await request(
        `/api/admin/auctions/${encodeURIComponent(item.auctionId)}/runs`,
        {
          method: "POST",
          headers: { ...adminHeaders, "Content-Type": "application/json" },
          body: JSON.stringify({ startsAt, expectedRevision: 1, publish: true }),
        },
      );
      assert(result.response.status === 201 && result.body?.runId, `Could not schedule ${item.auctionId}.`);
      scheduled.push({ ...item, runId: result.body.runId });
    }

    const catalog = await request("/api/auctions?limit=50");
    assert(catalog.response.ok, "Catalog endpoint failed.");
    for (const item of auctions) {
      assert(
        catalog.body?.auctions?.some((auction) => auction.auctionId === item.auctionId),
        `${item.auctionId} is missing from the public catalog.`,
      );
    }

    const waitMs = Date.parse(startsAt) - Date.now() + 600;
    if (waitMs > 0) await delay(waitMs);

    for (const item of scheduled) {
      const bidderId = `smoke-${randomUUID()}`;
      bidders.set(item.auctionId, bidderId);
      const entryKey = `fiszy:development:auction:${item.auctionId}:run:${item.runId}:entry:${encodeURIComponent(bidderId)}`;
      const stored = await redis([
        "SET",
        entryKey,
        JSON.stringify({ bidderId, fee: 5, grantedAt: new Date().toISOString(), provider: "test" }),
        "EX",
        600,
      ]);
      assert(stored === "OK", `Could not seed entry for ${item.auctionId}.`);
    }

    const buyOne = async (item) => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const detail = await request(`/api/auctions/${encodeURIComponent(item.auctionId)}`);
        assert(detail.response.ok && detail.body?.auction?.status === "live", `${item.auctionId} is not live.`);
        const result = await request(
          `/api/auctions/${encodeURIComponent(item.auctionId)}/runs/${encodeURIComponent(item.runId)}/buy`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              bidderId: bidders.get(item.auctionId),
              expectedPrice: detail.body.auction.currentPrice,
            }),
          },
        );
        if (result.body?.outcome === "price_changed") continue;
        return result;
      }
      throw new Error(`Price kept changing while testing ${item.auctionId}.`);
    };

    const alphaDetail = await request(
      `/api/auctions/${encodeURIComponent(scheduled[0].auctionId)}`,
    );
    const stalePrice = await request(
      `/api/auctions/${encodeURIComponent(scheduled[0].auctionId)}/runs/${encodeURIComponent(scheduled[0].runId)}/buy`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bidderId: bidders.get(scheduled[0].auctionId),
          expectedPrice: alphaDetail.body.auction.currentPrice + 1,
        }),
      },
    );
    assert(
      stalePrice.response.status === 409 && stalePrice.body?.outcome === "price_changed",
      "A deliberately stale visible price was not rejected.",
    );

    const [alphaFirst, alphaRetry, betaFirst] = await Promise.all([
      buyOne(scheduled[0]),
      buyOne(scheduled[0]),
      buyOne(scheduled[1]),
    ]);
    const purchaseResults = [alphaFirst, alphaRetry, betaFirst];
    for (const result of purchaseResults) {
      assert(
        result.response.ok && result.body?.outcome === "checkout",
        `Independent auction did not create checkout: ${result.response.status} ${JSON.stringify(result.body)}.`,
      );
    }
    assert(
      alphaFirst.body.checkoutUrl === alphaRetry.body.checkoutUrl,
      "Concurrent retry for the same winner did not recover the same Checkout.",
    );

    for (const item of scheduled) {
      const winnerKey = `fiszy:development:auction:${item.auctionId}:run:${item.runId}:winner`;
      const winnerRaw = await redis(["GET", winnerKey]);
      const winner = winnerRaw ? JSON.parse(winnerRaw) : null;
      assert(winner?.bidderId === bidders.get(item.auctionId), `Winner leaked across ${item.auctionId}.`);
      const cancelled = await request(
        `/api/auctions/${encodeURIComponent(item.auctionId)}/runs/${encodeURIComponent(item.runId)}/purchase/cancel`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bidderId: winner.bidderId }),
        },
      );
      assert(cancelled.body?.outcome === "cancelled", `Checkout cleanup failed for ${item.auctionId}.`);
    }

    completed = true;
    return {
      passed: true,
      health: "ready",
      adminSession: "HttpOnly cookie accepted",
      validationGuards: 2,
      parallelAuctions: scheduled.length,
      independentCheckouts: 2,
      concurrentWinnerRetry: true,
      exactPriceGuard: true,
    };
  } finally {
    for (const item of scheduled) {
      const bidderId = bidders.get(item.auctionId);
      const winnerKey = `fiszy:development:auction:${item.auctionId}:run:${item.runId}:winner`;
      const winnerRaw = await redis(["GET", winnerKey]);
      if (winnerRaw && bidderId) {
        await request(
          `/api/auctions/${encodeURIComponent(item.auctionId)}/runs/${encodeURIComponent(item.runId)}/purchase/cancel`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bidderId }),
          },
        );
      }
      await redis([
        "DEL",
        `fiszy:development:auction:${item.auctionId}:config`,
        `fiszy:development:auction:${item.auctionId}:run:${item.runId}:config`,
        winnerKey,
        `fiszy:development:auction:${item.auctionId}:run:${item.runId}:entry:${encodeURIComponent(bidderId ?? "")}`,
        `fiszy:development:auction:${item.auctionId}:index:v1:runs`,
      ]);
      await redis(["ZREM", "fiszy:development:index:v1:runs", `${item.auctionId}|${item.runId}`]);
    }
    for (const auctionId of created) {
      await redis([
        "DEL",
        `fiszy:development:auction:${auctionId}:record`,
        `fiszy:development:auction:${auctionId}:config`,
      ]);
      await redis(["ZREM", "fiszy:development:index:v1:auctions:all", auctionId]);
      await redis(["ZREM", "fiszy:development:index:v1:catalog", auctionId]);
    }
    if (!completed) {
      // The finally block deliberately cleans only the two generated IDs.
    }
  }
}

try {
  console.log(JSON.stringify(await run(), null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
