import assert from "node:assert/strict";
import test from "node:test";

import { adminPermissions, configuredAdminRole } from "../lib/admin-auth.ts";
import {
  defaultAuctionConfig,
  isAuctionEntryWindowOpen,
  parseAuctionDefinition,
  parseStoredAuctionDefinition,
} from "../lib/auction.ts";
import {
  normalizeStoredPostAuctionDiscount,
  preparePostAuctionDiscount,
} from "../lib/discount-storage.ts";
import {
  consumeAccountRateLimit,
  listAccountTickets,
  normalizeAccountProfilePatch,
  normalizeNotificationIds,
  normalizeSupportTicketInput,
} from "../lib/portal-storage.ts";
import { hasSameOrigin } from "../lib/request-origin.ts";

test("auction categories are explicit for new records and safely inferred for legacy records", () => {
  const definition = {
    productName: "PlayStation 5 Slim",
    productImageUrl: null,
    regularPrice: 2500,
    startPrice: 2200,
    floorPrice: 1500,
    durationMinutes: 10,
  };
  assert.equal(parseAuctionDefinition(definition)?.category, "gaming");
  assert.equal(parseAuctionDefinition(definition)?.entryFee, 5);
  assert.equal(parseAuctionDefinition(definition)?.startPrice, 2500);
  assert.equal(parseAuctionDefinition(definition)?.floorPrice, 1);
  assert.equal(parseAuctionDefinition({ ...definition, category: "electronics" })?.category, "electronics");
  assert.equal(parseAuctionDefinition({ ...definition, category: "invalid" }), null);
  assert.equal(parseAuctionDefinition({
    ...definition,
    postAuctionOffer: { enabled: true, validityDays: 7, inventory: null },
  })?.postAuctionOffer.enabled, true);
  assert.deepEqual(parseAuctionDefinition({
    ...definition,
    entryFee: 25,
    postAuctionOffer: { enabled: false, validityDays: 14, inventory: 3 },
  })?.postAuctionOffer, { enabled: true, validityDays: 14, inventory: null });
  assert.equal(parseAuctionDefinition({ ...definition, entryFee: 2500 }), null);
  assert.equal(parseAuctionDefinition({
    ...definition,
    postAuctionOffer: { enabled: true, validityDays: 0, inventory: null },
  }), null);
});

test("stored runs stay immutable while new definitions use the current pricing rules", () => {
  const stored = parseStoredAuctionDefinition({
    productName: "Historyczny produkt",
    productImageUrl: null,
    category: "other",
    postAuctionOffer: { enabled: false, validityDays: 7, inventory: 2 },
    regularPrice: 999,
    startPrice: 749,
    floorPrice: 699,
    durationMinutes: 10,
  });
  assert.equal(stored?.startPrice, 749);
  assert.equal(stored?.floorPrice, 699);
  assert.equal(stored?.postAuctionOffer.enabled, false);
  assert.equal(stored?.entryFee, 5);
});

test("entry checkout is available from publication until the exact auction start", () => {
  const config = { startsAt: "2026-08-18T10:01:00.000Z" };
  assert.equal(isAuctionEntryWindowOpen(Date.parse("2026-08-11T10:01:00.000Z"), config), true);
  assert.equal(isAuctionEntryWindowOpen(Date.parse("2026-08-18T09:59:59.999Z"), config), true);
  assert.equal(isAuctionEntryWindowOpen(Date.parse("2026-08-18T10:00:59.999Z"), config), true);
  assert.equal(isAuctionEntryWindowOpen(Date.parse("2026-08-18T10:01:00.000Z"), config), false);
  assert.equal(isAuctionEntryWindowOpen(Date.parse("2026-08-18T10:01:00.001Z"), config), false);
  assert.equal(isAuctionEntryWindowOpen(Date.now(), { startsAt: "invalid" }), false);
});

test("post-auction discount belongs only to an eligible loser and expires deterministically", () => {
  const now = Date.parse("2026-08-18T12:00:00.000Z");
  const config = {
    ...defaultAuctionConfig(),
    runId: "discount-unit-run",
    startsAt: "2026-08-18T10:00:00.000Z",
    regularPrice: 999,
    postAuctionOffer: { enabled: true, validityDays: 7, inventory: 12 },
  };
  const participant = {
    schemaVersion: 1,
    participantId: "clerk:user_loser",
    auctionId: "discount-unit-auction",
    runId: config.runId,
    entryStatus: "granted",
    entryFee: 5,
    entryPaymentProvider: "stripe",
    entryPaymentReference: "cs_entry_loser",
    entryPaymentSessionId: "cs_entry_loser",
    grantedAt: "2026-08-18T10:01:00.000Z",
  };
  const winner = {
    bidderId: "clerk:user_winner",
    price: 730,
    claimedAt: "2026-08-18T10:05:00.000Z",
  };
  const discount = preparePostAuctionDiscount({
    accountId: "user_loser",
    participant,
    config,
    winner,
    now,
  });
  assert.equal(discount?.discountAmount, 5);
  assert.equal(discount?.regularPrice, 999);
  assert.equal(discount?.finalPrice, 994);
  assert.equal(discount?.inventory, 12);
  assert.equal(discount?.state, "available");
  assert.equal(
    preparePostAuctionDiscount({
      accountId: "user_winner",
      participant: { ...participant, participantId: winner.bidderId },
      config,
      winner,
      now,
    }),
    null,
  );
  assert.equal(
    preparePostAuctionDiscount({
      accountId: "user_refunded",
      participant: {
        ...participant,
        participantId: "clerk:user_refunded",
        entryStatus: "refunded",
        refundedAt: "2026-08-18T10:02:00.000Z",
      },
      config,
      winner,
      now,
    }),
    null,
  );
  assert.equal(preparePostAuctionDiscount({
    accountId: "user_loser",
    participant,
    config,
    winner,
    now: Date.parse("2026-08-26T10:05:00.000Z"),
  })?.state, "expired");
});

test("reserved discount restores nullable fields removed by Redis Lua", () => {
  const reserved = normalizeStoredPostAuctionDiscount({
    schemaVersion: 1,
    discountId: "RABAT-1234567890ABCDEF1234567890ABCDEF12345678",
    accountId: "user_loser",
    participantId: "clerk:user_loser",
    auctionId: "discount-unit-auction",
    runId: "discount-unit-run",
    product: "Konsola PlayStation 5",
    regularPrice: 999,
    discountAmount: 5,
    finalPrice: 994,
    currency: "pln",
    issuedAt: "2026-08-18T10:10:00.000Z",
    expiresAt: "2026-08-25T10:10:00.000Z",
    state: "reserved",
    reservationToken: "6bad2738-1bb3-4fe3-887d-665566052bf9",
    reservedAt: "2026-08-18T10:12:00.000Z",
    reservationExpiresAt: "2026-08-18T10:43:00.000Z",
    reservationExpiresAtMs: 1_776_510_180_000,
  });
  assert.equal(reserved?.productImageUrl, null);
  assert.equal(reserved?.inventory, null);
  assert.equal(reserved?.state, "reserved");
  assert.equal(normalizeStoredPostAuctionDiscount({
    ...reserved,
    inventory: 0,
  }), null);
});

test("notification receipts accept only bounded opaque identifiers", () => {
  assert.deepEqual(normalizeNotificationIds(["win:auction-1:run-1", "TKT-ABC123", "TKT-ABC123"]), ["win:auction-1:run-1", "TKT-ABC123"]);
  assert.equal(normalizeNotificationIds([]), null);
  assert.equal(normalizeNotificationIds(["contains spaces"]), null);
  assert.equal(normalizeNotificationIds(Array.from({ length: 51 }, (_, index) => `notice-${index}`)), null);
});

test("account mutations accept only the exact browser origin", () => {
  const request = (origin) => ({ headers: new Headers(origin ? { origin } : {}), nextUrl: new URL("https://fiszy.example/api/account/profile") });
  assert.equal(hasSameOrigin(request("https://fiszy.example")), true);
  assert.equal(hasSameOrigin(request("https://evil.example")), false);
  assert.equal(hasSameOrigin(request(null)), false);
});

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

test("account support history accepts the first page without an invalid cursor purpose", async () => {
  const previousFetch = globalThis.fetch;
  const previousEnv = {
    url: process.env.KV_REST_API_URL,
    token: process.env.KV_REST_API_TOKEN,
    environment: process.env.VERCEL_ENV,
  };
  const commands = [];
  process.env.KV_REST_API_URL = "https://redis.portal-unit.invalid";
  process.env.KV_REST_API_TOKEN = "portal-unit";
  process.env.VERCEL_ENV = "development";
  globalThis.fetch = async (_url, init = {}) => {
    commands.push(JSON.parse(init.body));
    return Response.json({ result: [1] });
  };
  try {
    assert.deepEqual(
      await listAccountTickets({ accountId: `user_${"x".repeat(95)}`, limit: 20 }),
      { tickets: [], nextCursor: null },
    );
    assert.equal(commands.length, 1);
    assert.equal(commands[0][0], "EVAL");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousEnv.url === undefined) delete process.env.KV_REST_API_URL; else process.env.KV_REST_API_URL = previousEnv.url;
    if (previousEnv.token === undefined) delete process.env.KV_REST_API_TOKEN; else process.env.KV_REST_API_TOKEN = previousEnv.token;
    if (previousEnv.environment === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = previousEnv.environment;
  }
});
