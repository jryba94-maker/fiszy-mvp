import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";

const BASE_URL = "http://127.0.0.1:3000";
const AUCTION_ID = "demo-airpods-pro-1";

function parseDotEnv(contents) {
  const values = {};

  for (const line of contents.split(/\r?\n/)) {
    if (/^\s*(?:#|$)/.test(line)) continue;

    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;

    const [, name] = match;
    let value = match[2].trim();

    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      const quote = value[0];
      value = value.slice(1, -1);
      if (quote === '"') {
        value = value
          .replace(/\\n/g, "\n")
          .replace(/\\r/g, "\r")
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, "\\");
      }
    }

    values[name] = value;
  }

  return values;
}

async function readOptionalFile(path) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

async function loadDevelopmentSettings() {
  const local = parseDotEnv(await readOptionalFile(".env.local"));
  const development = parseDotEnv(
    await readOptionalFile(".env.development.local"),
  );

  return { ...local, ...development };
}

function firstDefined(settings, names) {
  for (const name of names) {
    if (settings[name]) return settings[name];
  }

  throw new Error(`Missing Development setting: ${names.join(", ")}`);
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Expected JSON from ${response.url} (${response.status}).`);
  }
}

async function requestJson(path, init = {}) {
  const response = await fetch(`${BASE_URL}${path}`, init);
  return { response, body: await readJson(response) };
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function run() {
  const settings = await loadDevelopmentSettings();

  if (settings.VERCEL_ENV !== "development") {
    throw new Error(
      "Race test is locked to VERCEL_ENV=development and was not started.",
    );
  }

  const redisUrl = firstDefined(settings, [
    "STORAGE_KV_REST_API_URL",
    "KV_REST_API_URL",
    "UPSTASH_REDIS_REST_URL",
  ]);
  const redisToken = firstDefined(settings, [
    "STORAGE_KV_REST_API_TOKEN",
    "KV_REST_API_TOKEN",
    "UPSTASH_REDIS_REST_TOKEN",
  ]);
  const adminSecret = firstDefined(settings, ["FISZY_ADMIN_SECRET"]);
  const stripeSecretKey = firstDefined(settings, ["STRIPE_SECRET_KEY"]);
  const expectedRedisHash = firstDefined(settings, [
    "FISZY_RACE_TEST_REDIS_URL_SHA256",
  ]).toLowerCase();

  if (!stripeSecretKey.startsWith("sk_test_")) {
    throw new Error("Race test requires a Stripe test-mode secret key.");
  }

  const actualRedisHash = createHash("sha256").update(redisUrl).digest("hex");
  if (!/^[a-f0-9]{64}$/.test(expectedRedisHash) || actualRedisHash !== expectedRedisHash) {
    throw new Error(
      "Race test Redis does not match the explicitly approved Development resource.",
    );
  }

  async function redis(command) {
    const response = await fetch(redisUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${redisToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(command),
    });
    const data = await readJson(response);

    if (!response.ok || data?.error) {
      throw new Error(`Development Redis command failed (${response.status}).`);
    }

    return data?.result ?? null;
  }

  const health = await requestJson("/api/admin/health");
  if (
    !health.response.ok ||
    health.body?.environment !== "development" ||
    health.body?.stripeTestMode !== true ||
    health.body?.raceTestStorageReady !== true
  ) {
    throw new Error(
      "Local server is not locked to the approved Development Redis and Stripe test mode.",
    );
  }

  const configKey = `fiszy:development:auction:${AUCTION_ID}:config`;
  const previousConfigRaw = await redis(["GET", configKey]);
  const bidderA = `race-a-${randomUUID()}`;
  const bidderB = `race-b-${randomUUID()}`;
  let runId = null;
  let entryKeyA = null;
  let entryKeyB = null;
  let winnerKey = null;
  let result = null;
  let testError = null;
  const cleanupErrors = [];
  let previousAuctionRestored = false;

  try {
    const scheduled = await requestJson("/api/admin/auction/start", {
      method: "POST",
      headers: { Authorization: `Bearer ${adminSecret}` },
    });

    if (!scheduled.response.ok || scheduled.body?.outcome !== "scheduled") {
      throw new Error(
        `Auction schedule failed (${scheduled.response.status}/${scheduled.body?.outcome ?? "unknown"}).`,
      );
    }

    runId = scheduled.body.runId;
    entryKeyA = `fiszy:development:auction:${AUCTION_ID}:run:${runId}:entry:${encodeURIComponent(bidderA)}`;
    entryKeyB = `fiszy:development:auction:${AUCTION_ID}:run:${runId}:entry:${encodeURIComponent(bidderB)}`;
    winnerKey = `fiszy:development:auction:${AUCTION_ID}:run:${runId}:winner`;

    const publicScheduled = await requestJson("/api/auction");
    if (publicScheduled.body?.runId !== runId) {
      throw new Error("Public API did not expose the newly scheduled Development run.");
    }

    const grantedAt = new Date().toISOString();
    const entryA = JSON.stringify({
      bidderId: bidderA,
      fee: 5,
      grantedAt,
      provider: "test",
    });
    const entryB = JSON.stringify({
      bidderId: bidderB,
      fee: 5,
      grantedAt,
      provider: "test",
    });

    const [setA, setB] = await Promise.all([
      redis(["SET", entryKeyA, entryA, "EX", 600]),
      redis(["SET", entryKeyB, entryB, "EX", 600]),
    ]);
    if (setA !== "OK" || setB !== "OK") {
      throw new Error("Could not seed both Development entries.");
    }

    const [entryCheckA, entryCheckB] = await Promise.all([
      requestJson(`/api/auction/entry?bidderId=${encodeURIComponent(bidderA)}`),
      requestJson(`/api/auction/entry?bidderId=${encodeURIComponent(bidderB)}`),
    ]);
    if (
      entryCheckA.body?.runId !== runId ||
      entryCheckB.body?.runId !== runId ||
      !entryCheckA.body?.hasEntry ||
      !entryCheckB.body?.hasEntry
    ) {
      throw new Error(
        `Development entry visibility failed (A=${Boolean(entryCheckA.body?.hasEntry)}, B=${Boolean(entryCheckB.body?.hasEntry)}).`,
      );
    }

    const waitMs = Date.parse(scheduled.body.startsAt) - Date.now() + 750;
    if (!Number.isFinite(waitMs) || waitMs > 90_000) {
      throw new Error("Scheduled start time is outside the safe test window.");
    }
    if (waitMs > 0) await delay(waitMs);

    const before = await requestJson("/api/auction");
    if (before.body?.runId !== runId || before.body?.status !== "live") {
      throw new Error(
        `Auction was not live at race start (${before.body?.status ?? "unknown"}).`,
      );
    }

    const buy = (bidderId) =>
      requestJson("/api/auction/buy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bidderId }),
      });

    const [responseA, responseB] = await Promise.all([
      buy(bidderA),
      buy(bidderB),
    ]);
    const responses = [
      { bidderId: bidderA, ...responseA },
      { bidderId: bidderB, ...responseB },
    ];
    const checkoutResponses = responses.filter(
      ({ response, body }) => response.status === 200 && body?.outcome === "checkout",
    );
    const lostResponses = responses.filter(
      ({ response, body }) => response.status === 409 && body?.outcome === "lost",
    );

    if (checkoutResponses.length !== 1 || lostResponses.length !== 1) {
      throw new Error(
        `Expected one checkout and one loss; received ${responses
          .map(({ response, body }) => `${response.status}/${body?.outcome ?? "unknown"}`)
          .join(", ")}.`,
      );
    }

    const winnerRaw = await redis(["GET", winnerKey]);
    if (!winnerRaw) throw new Error("Winner was not persisted in Development Redis.");

    const winner = JSON.parse(winnerRaw);
    if (!winner.paymentSessionId) {
      throw new Error("Winner Checkout Session was not attached.");
    }
    const stripeSessionResponse = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(winner.paymentSessionId)}`,
      { headers: { Authorization: `Bearer ${stripeSecretKey}` } },
    );
    const stripeSession = await readJson(stripeSessionResponse);
    if (
      !stripeSessionResponse.ok ||
      stripeSession?.success_url !== `${BASE_URL}/?purchase=success` ||
      stripeSession?.cancel_url !== `${BASE_URL}/?purchase=cancelled`
    ) {
      throw new Error("Winner Checkout has an unexpected return origin.");
    }

    const checkout = checkoutResponses[0];
    const lost = lostResponses[0];
    const after = await requestJson("/api/auction");

    if (winner.bidderId !== checkout.bidderId) {
      throw new Error("Persisted winner differs from the checkout response.");
    }
    if (winner.price !== checkout.body.price) {
      throw new Error("Checkout price differs from the persisted frozen price.");
    }
    if (lost.body.winnerPrice !== winner.price) {
      throw new Error("Loser did not receive the frozen winner price.");
    }
    if (
      after.body?.runId !== runId ||
      after.body?.status !== "payment_pending" ||
      after.body?.currentPrice !== winner.price
    ) {
      throw new Error("Public state does not show exactly one pending winner.");
    }

    const cancelled = await requestJson("/api/auction/purchase/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bidderId: winner.bidderId }),
    });
    if (!cancelled.response.ok || cancelled.body?.outcome !== "cancelled") {
      throw new Error(
        `Winner checkout cleanup failed (${cancelled.response.status}/${cancelled.body?.outcome ?? "unknown"}).`,
      );
    }

    if (await redis(["GET", winnerKey])) {
      throw new Error("Winner key remained after checkout cancellation.");
    }

    result = {
      passed: true,
      entryVisibility: "2/2",
      checkoutResponses: 1,
      lostResponses: 1,
      winnerStatus: checkout.response.status,
      loserStatus: lost.response.status,
      frozenPrice: winner.price,
      publicStatus: after.body.status,
      checkoutReturnOrigin: BASE_URL,
      checkoutCancelled: true,
    };
  } catch (error) {
    testError = error;
  } finally {
    if (runId && winnerKey) {
      try {
        const winnerRaw = await redis(["GET", winnerKey]);
        if (winnerRaw) {
          const winner = JSON.parse(winnerRaw);
          const cancelled = await requestJson("/api/auction/purchase/cancel", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bidderId: winner.bidderId }),
          });
          if (!cancelled.response.ok && cancelled.body?.outcome !== "nothing_to_cancel") {
            cleanupErrors.push("pending checkout could not be cancelled");
          }
        }
      } catch {
        cleanupErrors.push("pending checkout cleanup failed");
      }

      try {
        await redis(["DEL", entryKeyA, entryKeyB, winnerKey]);
      } catch {
        cleanupErrors.push("temporary race keys could not be removed");
      }

      try {
        const restoreScript = `
local raw = redis.call("GET", KEYS[1])
if not raw then return 0 end
local ok, data = pcall(cjson.decode, raw)
if not ok or data.runId ~= ARGV[1] then return 0 end
if ARGV[2] == "delete" then
  redis.call("DEL", KEYS[1])
else
  redis.call("SET", KEYS[1], ARGV[3])
end
return 1
`;
        const restored = await redis([
          "EVAL",
          restoreScript,
          1,
          configKey,
          runId,
          previousConfigRaw === null ? "delete" : "set",
          previousConfigRaw ?? "",
        ]);
        previousAuctionRestored = restored === 1;
        if (!previousAuctionRestored) {
          cleanupErrors.push("auction changed during the test, so it was not overwritten");
        }
      } catch {
        cleanupErrors.push("previous auction could not be restored");
      }
    }
  }

  if (testError) {
    const suffix = cleanupErrors.length
      ? ` Cleanup warning: ${cleanupErrors.join("; ")}.`
      : "";
    throw new Error(`${testError.message}${suffix}`);
  }
  if (cleanupErrors.length) {
    throw new Error(`Race passed, but cleanup failed: ${cleanupErrors.join("; ")}.`);
  }

  return { ...result, previousAuctionRestored };
}

try {
  const result = await run();
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
