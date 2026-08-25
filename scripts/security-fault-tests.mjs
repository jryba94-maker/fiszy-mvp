import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { NextRequest } from "next/server.js";

import { POST as postAdminSession } from "../app/api/admin/session/route.ts";
import { POST as postLegacyAdminAuctionStart } from "../app/api/admin/auction/start/route.ts";
import { POST as postAdminAuctionRun } from "../app/api/admin/auctions/[auctionId]/runs/route.ts";
import { POST as postStripeWebhook } from "../app/api/stripe/webhook/route.ts";
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_SECONDS,
  adminSessionToken,
  hasValidAdminRequest,
  isSameOriginAdminMutation,
  verifiedAdminActorType,
} from "../lib/admin-auth.ts";
import {
  attachAuctionWinnerCheckout,
  parseStoredAuctionConfig,
  readOptionalAuctionConfig,
  releaseAuctionWinner,
} from "../lib/auction-storage.ts";
import { defaultAuctionDefinition } from "../lib/auction.ts";
import {
  refundCheckoutSessionPayment,
  verifyStripeWebhook,
} from "../lib/stripe.ts";
import { rateLimitFingerprint } from "../lib/rate-limit-identity.ts";

const BASE_URL = "http://127.0.0.1:3000";
const SESSION_MARKER = "fiszy-admin-session-v1";

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

function required(settings, names) {
  for (const name of names) {
    if (settings[name]) return settings[name];
  }
  throw new Error(`Missing Development setting: ${names.join(", ")}`);
}

function fakeAdminRequest({ token, authorization, origin, url = BASE_URL } = {}) {
  const headers = new Headers();
  if (authorization) headers.set("authorization", authorization);
  if (origin !== undefined && origin !== null) headers.set("origin", origin);

  return {
    cookies: {
      get(name) {
        return name === ADMIN_SESSION_COOKIE && token ? { value: token } : undefined;
      },
    },
    headers,
    nextUrl: new URL(url),
  };
}

function forgedSessionToken(secret, expiresAt, nonce) {
  const signature = createHmac("sha256", secret)
    .update(`${SESSION_MARKER}:${expiresAt}:${nonce}`)
    .digest("base64url");
  return `${expiresAt}.${nonce}.${signature}`;
}

function stripeSignature(rawBody, secret, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  return `t=${timestamp},v1=${signature}`;
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

async function waitForLiveAuction(auctionId) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const result = await request(`/api/auctions/${encodeURIComponent(auctionId)}`);
    if (result.response.ok && result.body?.auction?.status === "live") {
      return result.body.auction;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Test auction ${auctionId} did not become live.`);
}

function checkoutSession({ id, kind, auctionId, runId, bidderId, amount }) {
  return {
    id,
    url: null,
    mode: "payment",
    payment_status: "paid",
    amount_total: amount,
    currency: "pln",
    metadata: { kind, auctionId, runId, bidderId },
    customer_details: null,
    collected_information: null,
  };
}

async function signedWebhook(event, secret, timestamp) {
  const rawBody = JSON.stringify(event);
  return request("/api/stripe/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "stripe-signature": stripeSignature(rawBody, secret, timestamp),
    },
    body: rawBody,
  });
}

test("admin session rejects expired, future and tampered cookies", () => {
  const previousSecret = process.env.FISZY_ADMIN_SECRET;
  const originalNow = Date.now;
  const secret = "unit-admin-secret-with-at-least-32-characters";
  const baseTime = 1_800_000_000_000;
  process.env.FISZY_ADMIN_SECRET = secret;

  try {
    Date.now = () => baseTime;
    const token = adminSessionToken(secret);
    assert.equal(hasValidAdminRequest(fakeAdminRequest({ token })), true);

    Date.now = () => baseTime + (ADMIN_SESSION_SECONDS + 1) * 1_000;
    assert.equal(hasValidAdminRequest(fakeAdminRequest({ token })), false);

    Date.now = () => baseTime;
    const nowSeconds = Math.floor(baseTime / 1_000);
    const nonce = "abcdefghijklmnopqrstuvwx";
    const tooFarFuture = forgedSessionToken(
      secret,
      String(nowSeconds + ADMIN_SESSION_SECONDS + 61),
      nonce,
    );
    assert.equal(hasValidAdminRequest(fakeAdminRequest({ token: tooFarFuture })), false);

    const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
    assert.equal(hasValidAdminRequest(fakeAdminRequest({ token: tampered })), false);
    assert.equal(
      hasValidAdminRequest(
        fakeAdminRequest({ authorization: `Bearer ${secret}` }),
      ),
      true,
    );
    assert.equal(
      hasValidAdminRequest(fakeAdminRequest({ authorization: "Bearer wrong" })),
      false,
    );
    assert.equal(
      verifiedAdminActorType(
        fakeAdminRequest({
          token: "stale-or-forged-cookie",
          authorization: `Bearer ${secret}`,
        }),
      ),
      "admin_api",
    );
    assert.equal(
      verifiedAdminActorType(
        fakeAdminRequest({ token, authorization: `Bearer ${secret}` }),
      ),
      "admin_session",
    );
  } finally {
    Date.now = originalNow;
    if (previousSecret === undefined) delete process.env.FISZY_ADMIN_SECRET;
    else process.env.FISZY_ADMIN_SECRET = previousSecret;
  }
});

test("admin mutation origin policy rejects cross-site requests", () => {
  assert.equal(
    isSameOriginAdminMutation(fakeAdminRequest({ origin: BASE_URL })),
    true,
  );
  assert.equal(
    isSameOriginAdminMutation(
      fakeAdminRequest({ origin: "https://attacker.example" }),
    ),
    false,
  );
  assert.equal(
    isSameOriginAdminMutation(fakeAdminRequest({ origin: "not a URL" })),
    false,
  );
  assert.equal(isSameOriginAdminMutation(fakeAdminRequest()), true);
});

test("auction config storage migrates only approved legacy record shapes", async () => {
  const timing = {
    runId: "legacy-timing-only-run",
    startsAt: "2026-08-10T01:00:00.000Z",
  };
  assert.deepEqual(parseStoredAuctionConfig(JSON.stringify(timing)), {
    schemaVersion: 2,
    ...timing,
    ...defaultAuctionDefinition(),
  });

  const completeWithoutCategory = {
    schemaVersion: 2,
    ...timing,
    productName: "Stored product",
    productImageUrl: null,
    regularPrice: 120,
    startPrice: 100,
    floorPrice: 90,
    durationMinutes: 10,
  };
  const migratedLegacy = {
    ...completeWithoutCategory,
    category: "other",
    entryFee: 5,
    postAuctionOffer: {
      enabled: false,
      validityDays: 7,
      inventory: null,
    },
  };
  const complete = {
    ...completeWithoutCategory,
    category: "other",
    entryFee: 5,
    postAuctionOffer: defaultAuctionDefinition().postAuctionOffer,
  };
  assert.deepEqual(
    parseStoredAuctionConfig(JSON.stringify(completeWithoutCategory)),
    migratedLegacy,
  );
  assert.deepEqual(parseStoredAuctionConfig(JSON.stringify(complete)), complete);
  assert.equal(
    parseStoredAuctionConfig(JSON.stringify({ ...complete, productName: null })),
    null,
  );
  assert.equal(
    parseStoredAuctionConfig(JSON.stringify({ ...timing, schemaVersion: 2 })),
    null,
  );
  assert.equal(
    parseStoredAuctionConfig(
      JSON.stringify({ ...timing, productName: "Incomplete definition" }),
    ),
    null,
  );
  assert.equal(
    parseStoredAuctionConfig(JSON.stringify({ ...complete, schemaVersion: 1 })),
    null,
  );

  const previousFetch = globalThis.fetch;
  const previousSettings = {
    KV_REST_API_URL: process.env.KV_REST_API_URL,
    KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN,
    VERCEL_ENV: process.env.VERCEL_ENV,
  };
  process.env.KV_REST_API_URL = "https://redis.config-unit.invalid";
  process.env.KV_REST_API_TOKEN = "unit-token";
  process.env.VERCEL_ENV = "development";
  globalThis.fetch = async () =>
    Response.json({
      result: JSON.stringify({ ...complete, productName: null }),
    });

  try {
    await assert.rejects(
      readOptionalAuctionConfig("demo-airpods-pro-1"),
      /Stored auction config is invalid/,
    );
  } finally {
    globalThis.fetch = previousFetch;
    for (const [name, value] of Object.entries(previousSettings)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("winner cancellation uses the exact claim without a Stripe session", async () => {
  const previousFetch = globalThis.fetch;
  const previousSettings = {
    KV_REST_API_URL: process.env.KV_REST_API_URL,
    KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    VERCEL_ENV: process.env.VERCEL_ENV,
  };
  const auctionId = "cancel-unit-auction";
  const runId = "cancel-unit-run";
  const bidderId = "cancel-unit-bidder";
  const claimedAt = "2026-08-10T01:02:03.000Z";
  let releaseCommand = null;

  process.env.KV_REST_API_URL = "https://redis.cancel-unit.invalid";
  process.env.KV_REST_API_TOKEN = "unit-token";
  delete process.env.STRIPE_SECRET_KEY;
  process.env.VERCEL_ENV = "development";
  globalThis.fetch = async (url, init = {}) => {
    assert.equal(String(url), "https://redis.cancel-unit.invalid");
    const command = JSON.parse(init.body);
    if (command[0] === "EVAL") {
      releaseCommand = command;
      return Response.json({ result: 1 });
    }
    throw new Error(`Unexpected Redis command in cancellation test: ${command[0]}`);
  };

  try {
    const released = await releaseAuctionWinner(
      runId,
      bidderId,
      undefined,
      auctionId,
      claimedAt,
    );
    assert.equal(released, 1);
    assert.ok(releaseCommand);
    assert.equal(releaseCommand[5], "", "Cancellation unexpectedly required a session id.");
    assert.equal(releaseCommand[6], claimedAt);
    const operationsSource = await readFile(
      new URL("../app/api/auctions/_shared/operations.ts", import.meta.url),
      "utf8",
    );
    const cancelSource = operationsSource.slice(operationsSource.indexOf("export async function handleCancelPost"));
    assert.ok(
      cancelSource.indexOf("if (!winner.paymentSessionId)") <
        cancelSource.indexOf("if (!isPaymentProviderConfigured())"),
      "Cancellation checks Stripe before handling a claim without a payment session.",
    );
  } finally {
    globalThis.fetch = previousFetch;
    for (const [name, value] of Object.entries(previousSettings)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("stale pending winner does not block a new run when expiry webhook is lost", async () => {
  const previousFetch = globalThis.fetch;
  const originalNow = Date.now;
  const previousSettings = {
    FISZY_ADMIN_SECRET: process.env.FISZY_ADMIN_SECRET,
    KV_REST_API_URL: process.env.KV_REST_API_URL,
    KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    VERCEL_ENV: process.env.VERCEL_ENV,
  };
  const now = Date.parse("2026-08-10T03:00:00.000Z");
  const secret = "unit-admin-secret-with-at-least-32-characters";
  const auctionId = "stale-winner-unit-auction";
  const runId = "stale-winner-unit-run";
  const definition = {
    productName: "Stale winner product",
    productImageUrl: "/stale-winner-unit.jpg",
    regularPrice: 120,
    startPrice: 120,
    floorPrice: 1,
    durationMinutes: 1,
  };
  const config = {
    schemaVersion: 2,
    runId,
    startsAt: new Date(now - 60 * 60 * 1000).toISOString(),
    ...definition,
  };
  const record = {
    schemaVersion: 1,
    auctionId,
    state: "published",
    currentRunId: runId,
    revision: 1,
    createdAt: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
    updatedAt: config.startsAt,
    ...definition,
  };
  const claimedAt = new Date(now - 40 * 60 * 1000).toISOString();
  const paymentSessionId = "cs_test_stale_winner_unit";
  let winner = {
    bidderId: "stale-winner-bidder",
    price: 97,
    claimedAt,
    paymentStatus: "pending",
    paymentSessionId,
    paymentExpiresAt: new Date(now - 9 * 60 * 1000).toISOString(),
  };
  let releases = 0;
  let schedules = 0;

  Date.now = () => now;
  process.env.FISZY_ADMIN_SECRET = secret;
  process.env.KV_REST_API_URL = "https://redis.stale-winner-unit.invalid";
  process.env.KV_REST_API_TOKEN = "unit-token";
  process.env.STRIPE_SECRET_KEY = "sk_test_stale_winner_unit";
  process.env.VERCEL_ENV = "development";
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (
      target ===
      `https://api.stripe.com/v1/checkout/sessions/${paymentSessionId}`
    ) {
      return Response.json({
        id: paymentSessionId,
        status: "expired",
        payment_status: "unpaid",
      });
    }
    assert.equal(target, "https://redis.stale-winner-unit.invalid");
    const command = JSON.parse(init.body);
    if (command[0] === "GET") {
      if (command[1].endsWith(":record")) {
        return Response.json({ result: JSON.stringify(record) });
      }
      if (command[1].endsWith(":config")) {
        return Response.json({ result: JSON.stringify(config) });
      }
      if (command[1].endsWith(":winner")) {
        return Response.json({ result: winner ? JSON.stringify(winner) : null });
      }
      if (command[1].endsWith(":order")) {
        return Response.json({ result: null });
      }
    }
    if (command[0] === "EVAL") {
      if (command[1].includes('if data.paymentStatus == "paid" then return 0 end')) {
        releases += 1;
        assert.equal(command[5], paymentSessionId);
        assert.equal(command[6], claimedAt);
        winner = null;
        return Response.json({ result: 1 });
      }
      if (command[1].includes('if redis.call("EXISTS", KEYS[3]) == 1 then return -1 end')) {
        schedules += 1;
        return Response.json({ result: 1 });
      }
      if (command[1].includes('if redis.call("EXISTS", KEYS[2]) == 1 then return -1 end')) {
        schedules += 1;
        return Response.json({ result: 1 });
      }
    }
    throw new Error(`Unexpected Redis command in stale-winner test: ${command[0]}`);
  };

  try {
    const response = await postAdminAuctionRun(
      new NextRequest(`${BASE_URL}/api/admin/auctions/${auctionId}/runs`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          expectedRevision: 1,
          startsAt: new Date(now + 2 * 60 * 1000).toISOString(),
        }),
      }),
      { params: Promise.resolve({ auctionId }) },
    );
    assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
    assert.equal((await response.json()).outcome, "scheduled");
    assert.equal(releases, 1);
    assert.equal(schedules, 1);

    winner = {
      bidderId: "stale-winner-bidder",
      price: 97,
      claimedAt,
      paymentStatus: "pending",
      paymentSessionId,
      paymentExpiresAt: new Date(now - 9 * 60 * 1000).toISOString(),
    };
    const legacyResponse = await postLegacyAdminAuctionStart(
      new NextRequest(`${BASE_URL}/api/admin/auction/start`, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}` },
      }),
    );
    assert.equal(legacyResponse.status, 200);
    assert.equal((await legacyResponse.json()).outcome, "scheduled");
    assert.equal(releases, 2);
    assert.equal(schedules, 2);
  } finally {
    globalThis.fetch = previousFetch;
    Date.now = originalNow;
    for (const [name, value] of Object.entries(previousSettings)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("admin login rate limit blocks the eleventh attempt and resets on success", async () => {
  const previousFetch = globalThis.fetch;
  const previousSettings = {
    FISZY_ADMIN_SECRET: process.env.FISZY_ADMIN_SECRET,
    KV_REST_API_URL: process.env.KV_REST_API_URL,
    KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN,
    VERCEL_ENV: process.env.VERCEL_ENV,
  };
  const secret = "unit-admin-secret-with-at-least-32-characters";
  const counters = new Map();
  process.env.FISZY_ADMIN_SECRET = secret;
  process.env.KV_REST_API_URL = "https://redis.unit.invalid";
  process.env.KV_REST_API_TOKEN = "unit-token";
  process.env.VERCEL_ENV = "development";

  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://redis.unit.invalid");
    const command = JSON.parse(init.body);
    if (command[0] === "EVAL") {
      const key = command[3];
      const attempts = (counters.get(key) ?? 0) + 1;
      counters.set(key, attempts);
      return Response.json({ result: attempts });
    }
    if (command[0] === "DEL") {
      const removed = counters.delete(command[1]);
      return Response.json({ result: removed ? 1 : 0 });
    }
    throw new Error(`Unexpected Redis command: ${command[0]}`);
  };

  function loginRequest(candidate, ip, origin) {
    const headers = new Headers({
      "Content-Type": "application/json",
      "x-forwarded-for": ip,
    });
    if (origin) headers.set("origin", origin);
    return new NextRequest(`${BASE_URL}/api/admin/session`, {
      method: "POST",
      headers,
      body: JSON.stringify({ secret: candidate }),
    });
  }

  try {
    const crossSite = await postAdminSession(
      loginRequest(secret, "198.51.100.1", "https://attacker.example"),
    );
    assert.equal(crossSite.status, 403);
    assert.equal(counters.size, 0, "CSRF rejection consumed a login attempt.");

    for (let attempt = 1; attempt <= 11; attempt += 1) {
      const response = await postAdminSession(
        loginRequest("wrong", "198.51.100.2"),
      );
      assert.equal(response.status, attempt <= 10 ? 401 : 429);
      if (attempt === 11) {
        assert.equal(response.headers.get("retry-after"), "900");
        assert.equal((await response.json()).outcome, "too_many_attempts");
      }
    }

    assert.equal(
      (await postAdminSession(loginRequest("wrong", "198.51.100.3"))).status,
      401,
    );
    const success = await postAdminSession(
      loginRequest(secret, "198.51.100.3"),
    );
    assert.equal(success.status, 200);
    assert.match(success.headers.get("set-cookie") ?? "", /HttpOnly/i);
    assert.match(success.headers.get("set-cookie") ?? "", /SameSite=Strict/i);
    assert.equal(
      (await postAdminSession(loginRequest("wrong", "198.51.100.3"))).status,
      401,
      "Successful login did not reset the counter.",
    );
  } finally {
    globalThis.fetch = previousFetch;
    for (const [name, value] of Object.entries(previousSettings)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("Stripe signatures enforce HMAC and timestamp tolerance", () => {
  const secret = "whsec_unit_test_only";
  const event = {
    id: "evt_unit_signature",
    type: "customer.created",
    data: { object: { id: "cus_unit" } },
  };
  const rawBody = JSON.stringify(event);
  const now = Math.floor(Date.now() / 1_000);

  assert.deepEqual(
    verifyStripeWebhook(rawBody, stripeSignature(rawBody, secret, now), secret),
    event,
  );
  assert.deepEqual(
    verifyStripeWebhook(
      rawBody,
      `t=${now},v1=deadbeef,v1=${stripeSignature(rawBody, secret, now).split("v1=")[1]}`,
      secret,
    ),
    event,
  );
  assert.throws(
    () => verifyStripeWebhook(rawBody, stripeSignature(rawBody, "wrong", now), secret),
    /verification failed/,
  );
  assert.throws(
    () => verifyStripeWebhook(rawBody, stripeSignature(rawBody, secret, now - 301), secret),
    /outside tolerance/,
  );
  assert.throws(
    () => verifyStripeWebhook(rawBody, "invalid", secret),
    /Invalid Stripe-Signature/,
  );
});

test("late-entry refund call is idempotent and never needs a real Stripe request", async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.STRIPE_SECRET_KEY;
  const calls = [];
  process.env.STRIPE_SECRET_KEY = "sk_test_unit_only";
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json({ id: `re_unit_${calls.length}` });
  };

  const session = {
    id: "cs_test_late_entry",
    payment_intent: "pi_test_late_entry",
  };

  try {
    await refundCheckoutSessionPayment(session);
    await refundCheckoutSessionPayment(session);
    assert.equal(calls.length, 2);
    for (const call of calls) {
      assert.equal(call.url, "https://api.stripe.com/v1/refunds");
      assert.equal(
        call.init.headers["Idempotency-Key"],
        "fiszy-entry-refund-cs_test_late_entry",
      );
      assert.equal(call.init.body.get("payment_intent"), "pi_test_late_entry");
    }

    globalThis.fetch = async () =>
      Response.json(
        { error: { code: "charge_already_refunded" } },
        { status: 400 },
      );
    await refundCheckoutSessionPayment(session);

    let unexpectedRequest = false;
    globalThis.fetch = async () => {
      unexpectedRequest = true;
      throw new Error("unexpected request");
    };
    await assert.rejects(
      refundCheckoutSessionPayment({ id: "cs_without_payment_intent" }),
      /no PaymentIntent/,
    );
    assert.equal(unexpectedRequest, false);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = previousKey;
  }
});

test("webhook orchestration handles refunds, duplicates, order-id upgrades and reordered expiry", async () => {
  const previousFetch = globalThis.fetch;
  const previousSettings = {
    KV_REST_API_URL: process.env.KV_REST_API_URL,
    KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    VERCEL_ENV: process.env.VERCEL_ENV,
  };
  const secret = "whsec_route_unit_test";
  const auctionId = "webhook-unit-auction";
  const runId = "webhook-unit-run";
  const config = {
    schemaVersion: 2,
    runId,
    startsAt: "2026-08-10T01:00:00.000Z",
    productName: "Webhook unit product",
    productImageUrl: null,
    entryFee: 7,
    regularPrice: 120,
    startPrice: 100,
    floorPrice: 90,
    durationMinutes: 1,
  };
  const redisCalls = [];
  const refundCalls = [];
  let winner = null;
  let grantResult = -1;
  let refundRecordWrites = 0;
  let orderSaveResults = [];
  const savedOrders = [];

  process.env.KV_REST_API_URL = "https://redis.webhook-unit.invalid";
  process.env.KV_REST_API_TOKEN = "unit-token";
  process.env.STRIPE_SECRET_KEY = "sk_test_route_unit";
  process.env.STRIPE_WEBHOOK_SECRET = secret;
  process.env.VERCEL_ENV = "development";

  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target === "https://redis.webhook-unit.invalid") {
      const command = JSON.parse(init.body);
      redisCalls.push(command);
      if (command[0] === "GET") {
        if (command[1].endsWith(":winner")) {
          return Response.json({ result: winner ? JSON.stringify(winner) : null });
        }
        if (command[1].endsWith(":config")) {
          return Response.json({ result: JSON.stringify(config) });
        }
        if (command[1].endsWith(":product-ref")) {
          return Response.json({ result: null });
        }
      }
      if (command[0] === "EVAL") {
        const script = command[1];
        if (script.includes('existing.entryStatus == "granted"')) {
          refundRecordWrites += 1;
          return Response.json({ result: 1 });
        }
        if (script.includes('local existingRaw = redis.call("GET", KEYS[2])')) {
          return Response.json({ result: grantResult });
        }
        if (script.includes('local winnerRaw = redis.call("GET", KEYS[5])')) {
          assert.match(
            script,
            /if sameOrderId then\s+redis\.call\("SET", KEYS\[4\], ARGV\[3\], "NX"\)\s+end/,
          );
          assert.match(script, /if not sameOrderId then return 2 end/);
          const replayReturn = script.indexOf("if not sameOrderId then return 2 end");
          for (const update of [
            'winner.paymentStatus = "paid"',
            'redis.call("SET", KEYS[2]',
            'redis.call("ZADD", KEYS[3]',
          ]) {
            const updateIndex = script.indexOf(update);
            assert.ok(updateIndex >= 0 && updateIndex < replayReturn);
          }
          savedOrders.push(JSON.parse(command[8]));
          return Response.json({ result: orderSaveResults.shift() ?? -2 });
        }
        if (script.includes('if data.paymentStatus == "paid" then return 0 end')) {
          winner = null;
          return Response.json({ result: 1 });
        }
        if (script.includes("record.counts[ARGV[2]]")) {
          return Response.json({ result: "{}" });
        }
      }
      throw new Error(`Unexpected Redis command in webhook test: ${command[0]}`);
    }

    if (target === "https://api.stripe.com/v1/refunds") {
      refundCalls.push(init);
      return Response.json({ id: `re_route_unit_${refundCalls.length}` });
    }
    throw new Error(`Unexpected network target in webhook test: ${target}`);
  };

  async function invoke(event, signatureSecret = secret) {
    const rawBody = JSON.stringify(event);
    return postStripeWebhook(
      new NextRequest(`${BASE_URL}/api/stripe/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "stripe-signature": stripeSignature(rawBody, signatureSecret),
        },
        body: rawBody,
      }),
    );
  }

  try {
    const invalid = await invoke(
      {
        id: "evt_route_invalid",
        type: "customer.created",
        data: { object: { id: "cus_route_invalid" } },
      },
      "whsec_wrong",
    );
    assert.equal(invalid.status, 400);
    assert.equal(redisCalls.length, 0);

    const lateSession = checkoutSession({
      id: "cs_test_route_late",
      kind: "auction_entry",
      auctionId,
      runId,
      bidderId: "route-late-bidder",
      amount: 700,
    });
    lateSession.payment_intent = "pi_test_route_late";
    const late = await invoke({
      id: "evt_route_late",
      type: "checkout.session.completed",
      data: { object: lateSession },
    });
    assert.equal(late.status, 200);
    assert.equal((await late.json()).kind, "auction_entry_refunded");
    assert.equal(refundCalls.length, 1);
    assert.equal(
      refundCalls[0].headers["Idempotency-Key"],
      "fiszy-entry-refund-cs_test_route_late",
    );
    assert.equal(refundRecordWrites, 1);

    grantResult = 1;
    winner = {
      bidderId: "route-purchase-bidder",
      price: 97,
      claimedAt: "2026-08-10T01:00:01.000Z",
      paymentStatus: "pending",
      paymentSessionId: "cs_test_route_purchase",
    };
    orderSaveResults = [1, 0];
    const purchaseEvent = {
      id: "evt_route_purchase",
      type: "checkout.session.completed",
      data: {
        object: checkoutSession({
          id: winner.paymentSessionId,
          kind: "auction_purchase",
          auctionId,
          runId,
          bidderId: winner.bidderId,
          amount: 9_700,
        }),
      },
    };
    for (let replay = 0; replay < 2; replay += 1) {
      const response = await invoke({ ...purchaseEvent, id: `evt_route_purchase_${replay}` });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).kind, "auction_purchase");
    }
    assert.deepEqual(orderSaveResults, []);
    assert.equal(savedOrders.length, 2);
    assert.match(savedOrders[0].orderId, /^FISZY-[A-F0-9]{64}$/);
    assert.equal(savedOrders[1].orderId, savedOrders[0].orderId);

    winner = {
      bidderId: "route-upgrade-replay-bidder",
      price: 96,
      claimedAt: "2026-08-10T01:00:01.250Z",
      paymentStatus: "pending",
      paymentSessionId: "cs_test_route_upgrade_replay",
    };
    orderSaveResults = [2];
    const upgradeReplay = await invoke({
      id: "evt_route_upgrade_replay",
      type: "checkout.session.completed",
      data: {
        object: checkoutSession({
          id: winner.paymentSessionId,
          kind: "auction_purchase",
          auctionId,
          runId,
          bidderId: winner.bidderId,
          amount: 9_600,
        }),
      },
    });
    assert.equal(upgradeReplay.status, 200);
    assert.equal((await upgradeReplay.json()).kind, "auction_purchase");
    assert.deepEqual(orderSaveResults, []);

    winner = {
      bidderId: "route-conflicting-order-bidder",
      price: 95,
      claimedAt: "2026-08-10T01:00:01.500Z",
      paymentStatus: "pending",
      paymentSessionId: "cs_test_route_conflicting_order",
    };
    orderSaveResults = [-3];
    const conflictResponse = await invoke({
      id: "evt_route_conflicting_order",
      type: "checkout.session.completed",
      data: {
        object: checkoutSession({
          id: winner.paymentSessionId,
          kind: "auction_purchase",
          auctionId,
          runId,
          bidderId: winner.bidderId,
          amount: 9_500,
        }),
      },
    });
    assert.equal(conflictResponse.status, 503);
    assert.equal((await conflictResponse.json()).outcome, "storage_error");
    assert.deepEqual(orderSaveResults, []);

    winner = {
      bidderId: "route-reordered-bidder",
      price: 96,
      claimedAt: "2026-08-10T01:00:02.000Z",
      paymentStatus: "pending",
      paymentSessionId: "cs_test_route_reordered",
    };
    const reorderedSession = checkoutSession({
      id: winner.paymentSessionId,
      kind: "auction_purchase",
      auctionId,
      runId,
      bidderId: winner.bidderId,
      amount: 9_600,
    });
    const expired = await invoke({
      id: "evt_route_expired",
      type: "checkout.session.expired",
      data: { object: { ...reorderedSession, payment_status: "unpaid" } },
    });
    assert.equal(expired.status, 200);
    assert.equal((await expired.json()).released, true);
    assert.equal(winner, null);

    const completedAfterExpiry = await invoke({
      id: "evt_route_completed_after_expiry",
      type: "checkout.session.completed",
      data: { object: reorderedSession },
    });
    assert.equal(completedAfterExpiry.status, 200);
    assert.equal((await completedAfterExpiry.json()).kind, "ignored");
    assert.deepEqual(orderSaveResults, []);
  } finally {
    globalThis.fetch = previousFetch;
    for (const [name, value] of Object.entries(previousSettings)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("Development fault suite: rate limits, webhook replay/order and winner CAS", async () => {
  const settings = {
    ...parseDotEnv(await optionalFile(".env.local")),
    ...parseDotEnv(await optionalFile(".env.development.local")),
  };
  assert.equal(
    settings.VERCEL_ENV,
    "development",
    "Fault tests are locked to VERCEL_ENV=development.",
  );

  const redisUrl = required(settings, [
    "STORAGE_KV_REST_API_URL",
    "KV_REST_API_URL",
    "UPSTASH_REDIS_REST_URL",
  ]);
  const redisToken = required(settings, [
    "STORAGE_KV_REST_API_TOKEN",
    "KV_REST_API_TOKEN",
    "UPSTASH_REDIS_REST_TOKEN",
  ]);
  const expectedRedisHash = required(settings, [
    "FISZY_RACE_TEST_REDIS_URL_SHA256",
  ]).toLowerCase();
  assert.equal(
    createHash("sha256").update(redisUrl).digest("hex"),
    expectedRedisHash,
    "Fault tests refused an unapproved Redis resource.",
  );
  assert.match(required(settings, ["STRIPE_SECRET_KEY"]), /^sk_test_/);
  const webhookSecret = required(settings, ["STRIPE_WEBHOOK_SECRET"]);
  const adminSecret = required(settings, ["FISZY_ADMIN_SECRET"]);

  Object.assign(process.env, settings);

  async function redis(command) {
    const response = await fetch(redisUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${redisToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(command),
    });
    const body = await json(response);
    if (!response.ok || body?.error) {
      throw new Error(`Development Redis command failed (${response.status}).`);
    }
    return body?.result ?? null;
  }

  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const auctionId = `fault-${suffix}`;
  const bidderId = `fault-entry-${suffix}`;
  const purchaseBidder = `fault-purchase-${suffix}`;
  const reorderedBidder = `fault-reordered-${suffix}`;
  const rateIp = `198.51.100.${Number.parseInt(suffix.slice(0, 2), 16) % 250 + 1}`;
  const rateFingerprint = rateLimitFingerprint("admin.login.ip", rateIp, 24);
  const rateKey = `fiszy:development:admin:login-attempts:${rateFingerprint}`;
  const casAuctionId = `fault-cas-${suffix}`;
  const casRunId = `run-${suffix}`;
  const casBidder = `fault-cas-bidder-${suffix}`;
  const casWinnerKey = `fiszy:development:auction:${casAuctionId}:run:${casRunId}:winner`;
  let runId = null;
  let orderId = null;

  try {
    const health = await request("/api/health");
    assert.equal(health.response.ok, true, "Local Development server is unavailable.");

    const adminHealth = await request("/api/admin/health", {
      headers: { Authorization: `Bearer ${adminSecret}` },
    });
    assert.equal(adminHealth.body?.environment, "development");
    assert.equal(adminHealth.body?.redisReachable, true);
    assert.equal(adminHealth.body?.raceTestStorageReady, true);
    assert.equal(adminHealth.body?.stripeTestMode, true);

    const csrf = await request("/api/admin/session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://attacker.example",
        "x-forwarded-for": `203.0.113.${Number.parseInt(suffix.slice(2, 4), 16) % 250 + 1}`,
      },
      body: JSON.stringify({ secret: adminSecret }),
    });
    assert.equal(csrf.response.status, 403);
    assert.equal(csrf.body?.outcome, "invalid_origin");

    const login = await request("/api/admin/session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": `203.0.113.${Number.parseInt(suffix.slice(4, 6), 16) % 250 + 1}`,
      },
      body: JSON.stringify({ secret: adminSecret }),
    });
    assert.equal(login.response.status, 200);
    const setCookie = login.response.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Strict/i);
    const cookie = setCookie.split(";", 1)[0];
    assert.ok(cookie);

    for (let attempt = 1; attempt <= 11; attempt += 1) {
      const limited = await request("/api/admin/session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": rateIp,
        },
        body: JSON.stringify({ secret: `wrong-${suffix}` }),
      });
      if (attempt <= 10) {
        assert.equal(limited.response.status, 401, `Attempt ${attempt} was not processed.`);
      } else {
        assert.equal(limited.response.status, 429);
        assert.equal(limited.body?.outcome, "too_many_attempts");
        assert.ok(limited.response.headers.get("retry-after"));
      }
    }

    const create = await request("/api/admin/auctions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        auctionId,
        productName: "Fault test product",
        productImageUrl: null,
        regularPrice: 120,
        startPrice: 100,
        floorPrice: 90,
        durationMinutes: 1,
        state: "published",
        startsAt: new Date(Date.now() + 2_000).toISOString(),
      }),
    });
    assert.equal(create.response.status, 201, JSON.stringify(create.body));
    runId = create.body?.config?.runId;
    assert.ok(runId);
    await waitForLiveAuction(auctionId);

    const missingSignature = await request("/api/stripe/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(missingSignature.response.status, 400);
    assert.equal(missingSignature.body?.outcome, "missing_signature");

    const invalidSignature = await request("/api/stripe/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": `t=${Math.floor(Date.now() / 1_000)},v1=deadbeef`,
      },
      body: "{}",
    });
    assert.equal(invalidSignature.response.status, 400);
    assert.equal(invalidSignature.body?.outcome, "invalid_signature");

    const staleEvent = {
      id: `evt_stale_${suffix}`,
      type: "customer.created",
      data: { object: { id: `cus_${suffix}` } },
    };
    const staleSignature = await signedWebhook(
      staleEvent,
      webhookSecret,
      Math.floor(Date.now() / 1_000) - 301,
    );
    assert.equal(staleSignature.response.status, 400);
    assert.equal(staleSignature.body?.outcome, "invalid_signature");

    const ignored = await signedWebhook(
      { ...staleEvent, id: `evt_ignored_${suffix}` },
      webhookSecret,
    );
    assert.equal(ignored.response.status, 200);
    assert.equal(ignored.body?.received, true);

    const entrySession = checkoutSession({
      id: `cs_test_entry_${suffix}`,
      kind: "auction_entry",
      auctionId,
      runId,
      bidderId,
      amount: 500,
    });
    const entryEvent = {
      id: `evt_entry_async_${suffix}`,
      type: "checkout.session.async_payment_succeeded",
      data: { object: entrySession },
    };
    const entryFirst = await signedWebhook(entryEvent, webhookSecret);
    assert.equal(entryFirst.response.status, 200);
    assert.equal(entryFirst.body?.kind, "auction_entry");
    const entryReplay = await signedWebhook(
      { ...entryEvent, id: `evt_entry_completed_${suffix}`, type: "checkout.session.completed" },
      webhookSecret,
    );
    assert.equal(entryReplay.response.status, 200);
    assert.equal(entryReplay.body?.kind, "auction_entry");

    const entryKey = `fiszy:development:auction:${auctionId}:run:${runId}:entry:${encodeURIComponent(bidderId)}`;
    const storedEntry = JSON.parse(await redis(["GET", entryKey]));
    assert.equal(storedEntry.paymentSessionId, entrySession.id);
    assert.equal(storedEntry.bidderId, bidderId);

    const winnerKey = `fiszy:development:auction:${auctionId}:run:${runId}:winner`;
    const purchaseSessionId = `cs_test_purchase_${suffix}`;
    await redis([
      "SET",
      winnerKey,
      JSON.stringify({
        bidderId: purchaseBidder,
        price: 97,
        claimedAt: new Date().toISOString(),
        paymentStatus: "pending",
        paymentSessionId: purchaseSessionId,
        paymentCheckoutUrl: `https://checkout.stripe.test/${purchaseSessionId}`,
      }),
      "EX",
      600,
    ]);
    const purchaseEvent = {
      id: `evt_purchase_${suffix}`,
      type: "checkout.session.completed",
      data: {
        object: checkoutSession({
          id: purchaseSessionId,
          kind: "auction_purchase",
          auctionId,
          runId,
          bidderId: purchaseBidder,
          amount: 9_700,
        }),
      },
    };
    const purchaseFirst = await signedWebhook(purchaseEvent, webhookSecret);
    assert.equal(purchaseFirst.response.status, 200);
    assert.equal(purchaseFirst.body?.kind, "auction_purchase");
    const purchaseReplay = await signedWebhook(purchaseEvent, webhookSecret);
    assert.equal(purchaseReplay.response.status, 200);
    assert.equal(purchaseReplay.body?.kind, "auction_purchase");

    const orderKey = `fiszy:development:auction:${auctionId}:run:${runId}:order`;
    const orderRaw = await redis(["GET", orderKey]);
    assert.ok(orderRaw);
    const order = JSON.parse(orderRaw);
    orderId = order.orderId;
    assert.equal(order.paymentSessionId, purchaseSessionId);
    assert.equal(order.bidderId, purchaseBidder);
    const paidWinner = JSON.parse(await redis(["GET", winnerKey]));
    assert.equal(paidWinner.paymentStatus, "paid");

    await redis(["DEL", winnerKey, orderKey]);
    await redis(["ZREM", "fiszy:development:index:v1:orders", `${auctionId}|${runId}`]);
    if (orderId) {
      await redis(["DEL", `fiszy:development:order-ref:${encodeURIComponent(orderId)}`]);
    }
    await redis(["DEL", `fiszy:development:auction:${auctionId}:order:latest`]);
    orderId = null;

    const reorderedSessionId = `cs_test_reordered_${suffix}`;
    await redis([
      "SET",
      winnerKey,
      JSON.stringify({
        bidderId: reorderedBidder,
        price: 96,
        claimedAt: new Date().toISOString(),
        paymentStatus: "pending",
        paymentSessionId: reorderedSessionId,
      }),
      "EX",
      600,
    ]);
    const reorderedSession = checkoutSession({
      id: reorderedSessionId,
      kind: "auction_purchase",
      auctionId,
      runId,
      bidderId: reorderedBidder,
      amount: 9_600,
    });
    const expiredFirst = await signedWebhook(
      {
        id: `evt_expired_${suffix}`,
        type: "checkout.session.expired",
        data: { object: reorderedSession },
      },
      webhookSecret,
    );
    assert.equal(expiredFirst.response.status, 200);
    assert.equal(expiredFirst.body?.released, true);
    const completedLate = await signedWebhook(
      {
        id: `evt_completed_late_${suffix}`,
        type: "checkout.session.completed",
        data: { object: reorderedSession },
      },
      webhookSecret,
    );
    assert.equal(completedLate.response.status, 200);
    assert.equal(completedLate.body?.kind, "ignored");
    assert.equal(await redis(["GET", winnerKey]), null);
    assert.equal(await redis(["GET", orderKey]), null);

    const oldClaimedAt = "2026-08-10T01:00:00.000Z";
    const newClaimedAt = "2026-08-10T01:00:01.000Z";
    await redis([
      "SET",
      casWinnerKey,
      JSON.stringify({
        bidderId: casBidder,
        price: 90,
        claimedAt: newClaimedAt,
        paymentStatus: "pending",
      }),
      "EX",
      600,
    ]);
    assert.equal(
      await attachAuctionWinnerCheckout(
        casRunId,
        casBidder,
        `cs_stale_${suffix}`,
        `https://checkout.stripe.test/cs_stale_${suffix}`,
        "2026-08-10T01:31:00.000Z",
        casAuctionId,
        oldClaimedAt,
      ),
      -1,
    );
    assert.equal(
      await releaseAuctionWinner(
        casRunId,
        casBidder,
        undefined,
        casAuctionId,
        oldClaimedAt,
      ),
      0,
    );
    assert.ok(await redis(["GET", casWinnerKey]));

    const currentSessionId = `cs_current_${suffix}`;
    assert.equal(
      await attachAuctionWinnerCheckout(
        casRunId,
        casBidder,
        currentSessionId,
        `https://checkout.stripe.test/${currentSessionId}`,
        "2026-08-10T01:31:01.000Z",
        casAuctionId,
        newClaimedAt,
      ),
      1,
    );
    assert.equal(
      await releaseAuctionWinner(
        casRunId,
        casBidder,
        `cs_other_${suffix}`,
        casAuctionId,
        newClaimedAt,
      ),
      0,
    );
    assert.equal(
      await releaseAuctionWinner(
        casRunId,
        casBidder,
        currentSessionId,
        casAuctionId,
        newClaimedAt,
      ),
      1,
    );
    assert.equal(await redis(["GET", casWinnerKey]), null);
  } finally {
    await redis(["DEL", rateKey, casWinnerKey]);
    if (runId) {
      const runReference = `${auctionId}|${runId}`;
      const entryKey = `fiszy:development:auction:${auctionId}:run:${runId}:entry:${encodeURIComponent(bidderId)}`;
      const winnerKey = `fiszy:development:auction:${auctionId}:run:${runId}:winner`;
      const orderKey = `fiszy:development:auction:${auctionId}:run:${runId}:order`;
      const participantKey = `fiszy:development:participant:${encodeURIComponent(bidderId)}:run:${auctionId}:${runId}`;
      await redis([
        "DEL",
        `fiszy:development:auction:${auctionId}:record`,
        `fiszy:development:auction:${auctionId}:config`,
        `fiszy:development:auction:${auctionId}:run:${runId}:config`,
        entryKey,
        winnerKey,
        orderKey,
        participantKey,
        `fiszy:development:participant:${encodeURIComponent(bidderId)}:index:v1:runs`,
        `fiszy:development:auction:${auctionId}:run:${runId}:index:v1:participants`,
        `fiszy:development:auction:${auctionId}:index:v1:runs`,
        `fiszy:development:auction:${auctionId}:order:latest`,
      ]);
      if (orderId) {
        await redis(["DEL", `fiszy:development:order-ref:${encodeURIComponent(orderId)}`]);
      }
      await redis(["ZREM", "fiszy:development:index:v1:auctions:all", auctionId]);
      await redis(["ZREM", "fiszy:development:index:v1:catalog", auctionId]);
      await redis(["ZREM", "fiszy:development:index:v1:runs", runReference]);
      await redis(["ZREM", "fiszy:development:index:v1:orders", runReference]);
    } else {
      await redis([
        "DEL",
        `fiszy:development:auction:${auctionId}:record`,
        `fiszy:development:auction:${auctionId}:config`,
      ]);
      await redis(["ZREM", "fiszy:development:index:v1:auctions:all", auctionId]);
      await redis(["ZREM", "fiszy:development:index:v1:catalog", auctionId]);
    }
  }
});
