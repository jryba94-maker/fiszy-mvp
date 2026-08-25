import assert from "node:assert/strict";
import test from "node:test";
import { createAuditEvent } from "../lib/audit-storage.ts";
import {
  adminPermissions,
  individualAdminAccountsConfigured,
  isAdminConfigured,
} from "../lib/admin-auth.ts";
import {
  enqueueTransactionalMessage,
  processMessageOutbox,
} from "../lib/message-outbox.ts";
import { paymentProviderHealth } from "../lib/payment-provider.ts";
import { isPrivacyRequestTransitionAllowed } from "../lib/privacy-storage.ts";
import {
  defaultProductInput,
  normalizeProductInput,
  productAuctionDefinition,
} from "../lib/product-storage.ts";
import { isServiceCaseTransitionAllowed, normalizeServiceCaseInput } from "../lib/service-case-storage.ts";

function withEnvironment(values, callback) {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]]),
  );
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("product input keeps auction invariants and normalizes SKU", () => {
  const input = normalizeProductInput({
    ...defaultProductInput(),
    sku: " fiszy-test-01 ",
    name: " Produkt testowy ",
    category: "electronics",
    status: "active",
    imageUrls: ["https://example.invalid/product.jpg"],
    inventory: { mode: "tracked", available: 5, reserved: 1 },
    auctionTemplate: {
      entryFee: 7,
      regularPrice: 999,
      durationMinutes: 60,
      postAuctionOfferValidityDays: 3,
    },
  });
  assert.ok(input);
  assert.equal(input.sku, "FISZY-TEST-01");

  const definition = productAuctionDefinition({
    schemaVersion: 1,
    productId: "PRD-0123456789ABCDEF01234567",
    ...input,
    revision: 1,
    createdAt: "2026-08-25T10:00:00.000Z",
    updatedAt: "2026-08-25T10:00:00.000Z",
  });
  assert.equal(definition.startPrice, 999);
  assert.equal(definition.regularPrice, 999);
  assert.equal(definition.floorPrice, 1);
  assert.equal(definition.entryFee, 7);
  assert.equal(definition.postAuctionOffer.enabled, true);
  assert.equal(definition.postAuctionOffer.validityDays, 3);
});

test("invalid product inventory and unsafe image URLs fail closed", () => {
  assert.equal(normalizeProductInput({
    ...defaultProductInput(),
    inventory: { mode: "tracked", available: 2, reserved: 3 },
  }), null);
  assert.equal(normalizeProductInput({
    ...defaultProductInput(),
    imageUrls: ["javascript:alert(1)"],
  }), null);
});

test("service cases require an order for returns and withdrawal", () => {
  const base = {
    subject: "Zwrot produktu",
    description: "Chcę zwrócić produkt zgodnie z zasadami.",
    contactEmail: "TEST@EXAMPLE.INVALID",
    expectation: "Zwrot środków",
  };
  assert.equal(normalizeServiceCaseInput({ ...base, kind: "return" }), null);
  const normalized = normalizeServiceCaseInput({
    ...base,
    kind: "withdrawal",
    orderId: " FISZY-UNIT-ORDER ",
  });
  assert.ok(normalized);
  assert.equal(normalized.contactEmail, "test@example.invalid");
  assert.equal(normalized.orderId, "FISZY-UNIT-ORDER");
});

test("service cases cannot reopen terminal decisions", () => {
  assert.equal(isServiceCaseTransitionAllowed("submitted", "reviewing"), true);
  assert.equal(isServiceCaseTransitionAllowed("reviewing", "waiting_for_customer"), true);
  assert.equal(isServiceCaseTransitionAllowed("accepted", "completed"), true);
  assert.equal(isServiceCaseTransitionAllowed("completed", "reviewing"), false);
  assert.equal(isServiceCaseTransitionAllowed("rejected", "submitted"), false);
});

test("Przelewy24 remains unavailable until its adapter is verified", () => {
  withEnvironment({
    FISZY_PAYMENT_PROVIDER: "przelewy24",
    P24_MERCHANT_ID: "12345",
    P24_POS_ID: "12345",
    P24_CRC: "unit-crc-value",
    P24_API_KEY: "unit-api-key",
    P24_SANDBOX: "true",
  }, () => {
    const health = paymentProviderHealth("preview");
    assert.equal(health.provider, "przelewy24");
    assert.equal(health.credentialsConfigured, true);
    assert.equal(health.adapterReady, false);
    assert.equal(health.configured, false);
    assert.equal(health.modeMatchesEnvironment, false);
  });
});

test("privacy requests follow verification and processing before completion", () => {
  assert.equal(isPrivacyRequestTransitionAllowed("requested", "verified"), true);
  assert.equal(isPrivacyRequestTransitionAllowed("verified", "processing"), true);
  assert.equal(isPrivacyRequestTransitionAllowed("processing", "completed"), true);
  assert.equal(isPrivacyRequestTransitionAllowed("requested", "completed"), false);
  assert.equal(isPrivacyRequestTransitionAllowed("completed", "processing"), false);
});

test("individual Clerk administrators require a valid map and signing secret", () => {
  withEnvironment({
    FISZY_ADMIN_SECRET: undefined,
    CLERK_SECRET_KEY: "sk_test_unit_clerk_secret",
    FISZY_ADMIN_USERS_JSON: JSON.stringify({ user_unitowner: "owner", user_unitsupport: "support" }),
  }, () => {
    assert.equal(individualAdminAccountsConfigured(), true);
    assert.equal(isAdminConfigured(), true);
    assert.deepEqual(adminPermissions("support"), ["users:read", "support:write"]);
  });
  withEnvironment({
    FISZY_ADMIN_SECRET: undefined,
    CLERK_SECRET_KEY: undefined,
    FISZY_ADMIN_USERS_JSON: JSON.stringify({ user_unitowner: "owner" }),
  }, () => assert.equal(isAdminConfigured(), false));
  withEnvironment({
    CLERK_SECRET_KEY: "sk_test_unit_clerk_secret",
    FISZY_ADMIN_USERS_JSON: JSON.stringify({ "wrong-id": "owner" }),
  }, () => assert.equal(individualAdminAccountsConfigured(), false));
});

test("new operational audit actions reject extra or sensitive metadata", () => {
  const event = createAuditEvent({
    actorType: "admin_clerk",
    actorRef: "0123456789abcdef0123",
    action: "service_case.updated",
    resourceType: "service_case",
    resourceId: "CASE-0123456789ABCDEF01234567",
    outcome: "success",
    details: {
      previousStatus: "submitted",
      status: "reviewing",
      revision: 2,
      responseChanged: false,
    },
  });
  assert.equal(event.actorType, "admin_clerk");
  assert.equal(event.actorRef, "0123456789abcdef0123");

  assert.throws(() => createAuditEvent({
    ...event,
    details: { ...event.details, email: "must-not-enter-audit@example.invalid" },
  }), /Invalid audit event/);
});

test("scheduled transactional messages pass through the durable outbox exactly once", async () => {
  const previousFetch = globalThis.fetch;
  const previousEnvironment = {
    KV_REST_API_URL: process.env.KV_REST_API_URL,
    KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    FISZY_EMAIL_FROM: process.env.FISZY_EMAIL_FROM,
  };
  const values = new Map();
  const due = new Map();
  const sent = [];
  process.env.KV_REST_API_URL = "https://redis.invalid";
  process.env.KV_REST_API_TOKEN = "unit-token";
  process.env.RESEND_API_KEY = "re_unit_key";
  process.env.FISZY_EMAIL_FROM = "Fiszy <unit@example.invalid>";

  globalThis.fetch = async (url, init) => {
    if (String(url) === "https://api.resend.com/emails") {
      sent.push(JSON.parse(String(init.body)));
      return { ok: true, status: 200, async json() { return {}; } };
    }
    const command = JSON.parse(String(init.body));
    let result = null;
    if (command[0] === "ZRANGEBYSCORE") {
      const maximum = Number(command[3]);
      result = [...due.entries()].filter(([, score]) => score <= maximum).map(([id]) => id);
    } else if (command[0] === "GET") {
      result = values.get(command[1]) ?? null;
    } else if (command[0] === "EVAL" && String(command[1]).includes('redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[5])')) {
      const keys = command.slice(3, 7);
      const args = command.slice(7);
      if (values.has(keys[0])) result = [0, values.get(keys[0])];
      else {
        values.set(keys[0], args[0]);
        values.set(keys[1], args[1]);
        due.set(args[0], Number(args[2]));
        result = [1, args[0]];
      }
    } else if (command[0] === "EVAL" && String(command[1]).includes('current.state = "sending"')) {
      const keys = command.slice(3, 5);
      const args = command.slice(5);
      const current = JSON.parse(values.get(keys[0]));
      current.state = "sending";
      current.attempts += 1;
      current.nextAttemptAt = args[2];
      current.updatedAt = args[3];
      const encoded = JSON.stringify(current);
      values.set(keys[0], encoded);
      due.set(args[0], Number(args[5]));
      result = encoded;
    } else if (command[0] === "EVAL" && String(command[1]).includes('current.state ~= "sending"')) {
      const keys = command.slice(3, 5);
      const args = command.slice(5);
      values.set(keys[0], args[1]);
      if (String(args[3]) === "1") due.delete(args[4]);
      else due.set(args[4], Number(args[5]));
      result = 1;
    } else {
      throw new Error(`Unexpected unit Redis command: ${command[0]}`);
    }
    return { ok: true, status: 200, async json() { return { result }; } };
  };

  try {
    const queued = await enqueueTransactionalMessage({
      dedupeKey: "waitlist.unit.12345",
      recipient: "person@example.invalid",
      template: "auction_reminder",
      title: "Aukcja startuje za godzinę",
      text: "Przygotuj swój moment.",
      scheduledAt: "2026-08-26T18:00:00.000Z",
    });
    assert.equal(queued.created, true);
    const processed = await processMessageOutbox({ limit: 5 });
    assert.deepEqual(processed, { processed: 1, delivered: 1, retried: 0, dead: 0, errors: 0 });
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].to, ["person@example.invalid"]);
    assert.equal(sent[0].scheduled_at, "2026-08-26T18:00:00.000Z");
  } finally {
    globalThis.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
