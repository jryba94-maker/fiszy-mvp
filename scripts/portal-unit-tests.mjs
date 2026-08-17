import assert from "node:assert/strict";
import test from "node:test";

import { adminPermissions, configuredAdminRole } from "../lib/admin-auth.ts";
import {
  consumeAccountRateLimit,
  normalizeAccountProfilePatch,
  normalizeSupportTicketInput,
} from "../lib/portal-storage.ts";

test("portal profile accepts complete preferences and rejects malformed addresses", () => {
  const valid = normalizeAccountProfilePatch({
    fullName: "Jan Kowalski",
    phone: "+48 500 600 700",
    address: { label: "Dom", line1: "Prosta 1", line2: null, postalCode: "00-001", city: "Warszawa", country: "Polska" },
    preferences: { emailAuctionStart: true, emailWin: true, emailOrderUpdates: true, marketing: false, analytics: false },
  });
  assert.equal(valid?.address?.city, "Warszawa");
  assert.equal(normalizeAccountProfilePatch({ ...valid, address: { line1: "bez reszty" } }), null);
});

test("support ticket validation is bounded and strips surrounding whitespace", () => {
  assert.deepEqual(normalizeSupportTicketInput({ category: "complaint", subject: "  Wadliwy produkt  ", message: "  Proszę o kontakt w sprawie produktu.  ", orderId: " FISZY-1 " }), {
    category: "complaint",
    subject: "Wadliwy produkt",
    message: "Proszę o kontakt w sprawie produktu.",
    orderId: "FISZY-1",
  });
  assert.equal(normalizeSupportTicketInput({ category: "unknown", subject: "Test", message: "Wiadomość" }), null);
  assert.equal(normalizeSupportTicketInput({ category: "other", subject: "x".repeat(121), message: "Wiadomość" }), null);
});

test("admin roles expose least-privilege permission sets", () => {
  const previous = process.env.FISZY_ADMIN_ROLE;
  try {
    process.env.FISZY_ADMIN_ROLE = "support";
    assert.equal(configuredAdminRole(), "support");
    assert.deepEqual(adminPermissions(), ["users:read", "support:write"]);
    process.env.FISZY_ADMIN_ROLE = "invalid";
    assert.equal(configuredAdminRole(), "owner");
  } finally {
    if (previous === undefined) delete process.env.FISZY_ADMIN_ROLE;
    else process.env.FISZY_ADMIN_ROLE = previous;
  }
});

test("account rate limit uses a pseudonymous expiring key", async () => {
  const previousFetch = globalThis.fetch;
  const previousEnv = { url: process.env.KV_REST_API_URL, token: process.env.KV_REST_API_TOKEN, environment: process.env.VERCEL_ENV };
  const commands = [];
  process.env.KV_REST_API_URL = "https://redis.portal-unit.invalid";
  process.env.KV_REST_API_TOKEN = "portal-unit";
  process.env.VERCEL_ENV = "development";
  globalThis.fetch = async (_url, init = {}) => {
    const command = JSON.parse(init.body);
    commands.push(command);
    return Response.json({ result: 1 });
  };
  try {
    assert.equal(await consumeAccountRateLimit({ accountId: "user_test_123", action: "support", limit: 5, windowSeconds: 600 }), true);
    assert.equal(commands[0][0], "EVAL");
    assert.match(commands[0][3], /^fiszy:development:rate:v1:portal:support:[a-f0-9]{32}$/);
    assert.equal(commands[0][3].includes("user_test_123"), false);
    assert.equal(commands[0][4], 600);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousEnv.url === undefined) delete process.env.KV_REST_API_URL; else process.env.KV_REST_API_URL = previousEnv.url;
    if (previousEnv.token === undefined) delete process.env.KV_REST_API_TOKEN; else process.env.KV_REST_API_TOKEN = previousEnv.token;
    if (previousEnv.environment === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = previousEnv.environment;
  }
});
