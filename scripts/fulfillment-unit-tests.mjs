import assert from "node:assert/strict";
import test from "node:test";
import {
  AUDIT_RETENTION_SECONDS,
  appendAuditEvent,
  createAuditEvent,
  listAuditEvents,
  parseStoredAuditEvent,
} from "../lib/audit-storage.ts";
import {
  defaultOrderFulfillment,
  isFulfillmentTransitionAllowed,
  prepareFulfillmentPatch,
  updateOrderFulfillment,
} from "../lib/fulfillment-storage.ts";
import {
  listAuctionOrders,
  readAuctionOrderById,
} from "../lib/order-storage.ts";
import {
  listSortedSetPage,
  looksLikeSortedSetCursor,
} from "../lib/sorted-set-pagination.ts";
import { sendOrderFulfillmentUpdate } from "../lib/transactional-email.ts";

const order = {
  orderId: "FISZY-UNIT-ORDER",
  auctionId: "unit-auction",
  runId: "unit-run",
  bidderId: "unit-bidder",
  product: "Produkt testowy",
  amount: 100,
  currency: "pln",
  paymentSessionId: "payment-reference-not-for-audit",
  paidAt: "2026-08-11T10:00:00.000Z",
  customer: {
    name: "Test User",
    email: "test@example.invalid",
    phone: null,
  },
  shippingAddress: null,
};

test("legacy order receives a compatible synthetic new fulfillment", () => {
  assert.deepEqual(defaultOrderFulfillment(order), {
    schemaVersion: 1,
    orderId: order.orderId,
    auctionId: order.auctionId,
    runId: order.runId,
    status: "new",
    revision: 0,
    tracking: null,
    note: null,
    createdAt: order.paidAt,
    updatedAt: order.paidAt,
    shippedAt: null,
    deliveredAt: null,
  });
});

test("fulfillment transitions reject unsafe skips and require tracking", () => {
  const current = defaultOrderFulfillment(order);

  assert.equal(isFulfillmentTransitionAllowed("delivered", "preparing"), false);
  assert.deepEqual(
    prepareFulfillmentPatch(current, {
      expectedRevision: 0,
      status: "delivered",
      tracking: { carrier: "DHL", trackingNumber: "123" },
    }),
    { ok: false, outcome: "invalid_transition" },
  );
  assert.deepEqual(
    prepareFulfillmentPatch(current, {
      expectedRevision: 0,
      status: "shipped",
    }),
    { ok: false, outcome: "invalid_request" },
  );

  const prepared = prepareFulfillmentPatch(current, {
    expectedRevision: 0,
    status: "shipped",
    tracking: { carrier: " DHL ", trackingNumber: " UNIT-123 " },
    note: " Paczka przekazana kurierowi ",
  });
  assert.equal(prepared.ok, true);
  if (prepared.ok) {
    assert.deepEqual(prepared.value.tracking, {
      carrier: "DHL",
      trackingNumber: "UNIT-123",
    });
    assert.equal(prepared.value.note, "Paczka przekazana kurierowi");
  }

  const flatPrepared = prepareFulfillmentPatch(current, {
    expectedRevision: 0,
    status: "shipped",
    carrier: "InPost",
    trackingNumber: "FLAT-123",
    note: null,
  });
  assert.equal(flatPrepared.ok, true);
  if (flatPrepared.ok) {
    assert.deepEqual(flatPrepared.value.tracking, {
      carrier: "InPost",
      trackingNumber: "FLAT-123",
    });
  }
});

test("rolling a shipment below shipped clears shipped and delivered timestamps", async () => {
  const previousFetch = globalThis.fetch;
  const previousUrl = process.env.KV_REST_API_URL;
  const previousToken = process.env.KV_REST_API_TOKEN;
  process.env.KV_REST_API_URL = "https://redis.invalid";
  process.env.KV_REST_API_TOKEN = "unit-token";
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      return { result: 1 };
    },
  });

  try {
    const current = {
      ...defaultOrderFulfillment(order),
      status: "shipped",
      revision: 2,
      tracking: { carrier: "DHL", trackingNumber: "UNIT-123" },
      updatedAt: "2026-08-11T10:02:00.000Z",
      shippedAt: "2026-08-11T10:02:00.000Z",
      deliveredAt: null,
    };
    const prepared = prepareFulfillmentPatch(current, {
      expectedRevision: 2,
      status: "preparing",
    });
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;

    const result = await updateOrderFulfillment({
      order,
      current,
      patch: prepared.value,
      actorType: "admin_session",
      eventId: "unit-rollback-event",
      occurredAt: "2026-08-11T10:03:00.000Z",
    });
    assert.equal(result.outcome, "updated");
    if (result.outcome === "updated") {
      assert.equal(result.fulfillment.status, "preparing");
      assert.equal(result.fulfillment.shippedAt, null);
      assert.equal(result.fulfillment.deliveredAt, null);
    }
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.KV_REST_API_URL;
    else process.env.KV_REST_API_URL = previousUrl;
    if (previousToken === undefined) delete process.env.KV_REST_API_TOKEN;
    else process.env.KV_REST_API_TOKEN = previousToken;
  }
});

test("audit parser accepts only flat, bounded, non-secret metadata", () => {
  const event = createAuditEvent(
    {
      actorType: "admin_session",
      action: "order.fulfillment.updated",
      resourceType: "order",
      resourceId: order.orderId,
      outcome: "success",
      details: {
        previousStatus: "new",
        status: "preparing",
        revision: 1,
        trackingChanged: false,
        noteChanged: false,
        trackingPresent: false,
      },
    },
    {
      eventId: "unit-audit-event",
      occurredAt: "2026-08-11T10:01:00.000Z",
    },
  );
  assert.deepEqual(parseStoredAuditEvent(JSON.stringify(event)), event);
  assert.throws(
    () => createAuditEvent({
      actorType: "admin_session",
      action: "order.fulfillment.updated",
      resourceType: "order",
      resourceId: order.orderId,
      outcome: "success",
      details: { nested: { forbidden: true } },
    }),
    /Invalid audit event/,
  );
  assert.throws(
    () => createAuditEvent({
      actorType: "admin_session",
      action: "order.fulfillment.updated",
      resourceType: "order",
      resourceId: order.orderId,
      outcome: "success",
      details: {
        previousStatus: "new",
        status: "preparing",
        revision: 1,
        trackingChanged: false,
        noteChanged: false,
        trackingPresent: false,
        token: "must-never-enter-audit",
      },
    }),
    /Invalid audit event/,
  );
});

test("auction audit actions accept only their PII-free schemas", () => {
  const cases = [
    {
      action: "auction.created",
      details: { state: "draft", scheduled: false, revision: 1 },
    },
    {
      action: "auction.updated",
      details: {
        previousState: "draft",
        state: "published",
        revision: 2,
        definitionChanged: true,
      },
    },
    {
      action: "auction.run.scheduled",
      details: {
        runId: "run-unit-2",
        startsAt: "2026-08-11T12:00:00.000Z",
        revision: 3,
      },
    },
  ];

  for (const candidate of cases) {
    const event = createAuditEvent({
      actorType: "admin_session",
      action: candidate.action,
      resourceType: "auction",
      resourceId: order.auctionId,
      outcome: "success",
      details: candidate.details,
    });
    assert.equal(event.action, candidate.action);
  }
});

test("audit writes expire events and reads prune retained indexes without totals", async () => {
  const previousFetch = globalThis.fetch;
  const previousUrl = process.env.KV_REST_API_URL;
  const previousToken = process.env.KV_REST_API_TOKEN;
  const commands = [];
  const event = createAuditEvent(
    {
      actorType: "admin_session",
      action: "order.fulfillment.updated",
      resourceType: "order",
      resourceId: order.orderId,
      outcome: "success",
      details: {
        previousStatus: "new",
        status: "preparing",
        revision: 1,
        trackingChanged: false,
        noteChanged: false,
        trackingPresent: false,
      },
    },
    {
      eventId: "unit-retained-event",
      occurredAt: "2026-08-11T10:01:00.000Z",
    },
  );
  process.env.KV_REST_API_URL = "https://redis.invalid";
  process.env.KV_REST_API_TOKEN = "unit-token";
  globalThis.fetch = async (_url, init) => {
    const command = JSON.parse(init.body);
    commands.push(command);
    let result = null;
    if (command[0] === "EVAL" && command[2] === 3) result = 1;
    else if (command[0] === "EVAL" && command[2] === 1) {
      result = [1, event.eventId];
    } else if (command[0] === "MGET") {
      result = [JSON.stringify(event)];
    }
    return {
      ok: true,
      async json() {
        return { result };
      },
    };
  };

  try {
    assert.equal(await appendAuditEvent(event), 1);
    const page = await listAuditEvents({ limit: 20 });
    assert.deepEqual(page, { events: [event], nextCursor: null });
    assert.equal(Object.hasOwn(page, "total"), false);

    const appendCommand = commands[0];
    assert.match(appendCommand[1], /SET.+EX/s);
    assert.match(appendCommand[1], /ZREMRANGEBYSCORE/);
    assert.match(appendCommand[1], /EXPIRE/);
    assert.equal(appendCommand[9], AUDIT_RETENTION_SECONDS);
    const readCommand = commands.find(
      (command) => command[0] === "EVAL" && command[2] === 1,
    );
    assert.match(readCommand[1], /ZREMRANGEBYSCORE/);
    assert.equal(typeof readCommand[6], "number");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.KV_REST_API_URL;
    else process.env.KV_REST_API_URL = previousUrl;
    if (previousToken === undefined) delete process.env.KV_REST_API_TOKEN;
    else process.env.KV_REST_API_TOKEN = previousToken;
  }
});

test("order lookup resolves a safe order-id reference without scanning Redis", async () => {
  const previousFetch = globalThis.fetch;
  const previousUrl = process.env.KV_REST_API_URL;
  const previousToken = process.env.KV_REST_API_TOKEN;
  const results = [`${order.auctionId}|${order.runId}`, JSON.stringify(order)];
  const commands = [];
  process.env.KV_REST_API_URL = "https://redis.invalid";
  process.env.KV_REST_API_TOKEN = "unit-token";
  globalThis.fetch = async (_url, init) => {
    commands.push(JSON.parse(init.body));
    return {
      ok: true,
      async json() {
        return { result: results.shift() ?? null };
      },
    };
  };

  try {
    assert.deepEqual(await readAuctionOrderById(order.orderId), {
      ...order,
      paymentProvider: "stripe",
      paymentReference: order.paymentSessionId,
    });
    assert.equal(commands.length, 2);
    assert.deepEqual(commands.map((command) => command[0]), ["GET", "GET"]);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.KV_REST_API_URL;
    else process.env.KV_REST_API_URL = previousUrl;
    if (previousToken === undefined) delete process.env.KV_REST_API_TOKEN;
    else process.env.KV_REST_API_TOKEN = previousToken;
  }
});

test("order pages use a stable opaque cursor, one legacy repair, and batched reads", async () => {
  const previousFetch = globalThis.fetch;
  const previousUrl = process.env.KV_REST_API_URL;
  const previousToken = process.env.KV_REST_API_TOKEN;
  const commands = [];
  let pageNumber = 0;
  let batchNumber = 0;
  const pageOrders = [0, 1, 2].map((index) => ({
    ...order,
    orderId: `${order.orderId}-${index + 1}`,
    runId: `${order.runId}-${index + 1}`,
  }));
  const normalizedPageOrders = pageOrders.map((item) => ({
    ...item,
    paymentProvider: "stripe",
    paymentReference: item.paymentSessionId,
  }));
  const references = pageOrders.map(
    (item) => `${item.auctionId}|${item.runId}`,
  );
  process.env.KV_REST_API_URL = "https://redis.invalid";
  process.env.KV_REST_API_TOKEN = "unit-token";
  globalThis.fetch = async (_url, init) => {
    const command = JSON.parse(init.body);
    commands.push(command);
    let result = null;
    if (command[0] === "EVAL") {
      result = pageNumber++ === 0
        ? [1, references[0], references[1], references[2]]
        : [1, references[2]];
    } else if (command[0] === "MGET") {
      result = batchNumber++ === 0
        ? [JSON.stringify(pageOrders[0]), JSON.stringify(pageOrders[1])]
        : [JSON.stringify(pageOrders[2])];
    }
    return {
      ok: true,
      async json() {
        return { result };
      },
    };
  };

  try {
    const first = await listAuctionOrders({ limit: 2 });
    assert.deepEqual(first.orders, normalizedPageOrders.slice(0, 2));
    assert.equal(typeof first.nextCursor, "string");
    assert.notEqual(first.nextCursor, "2");

    const second = await listAuctionOrders({
      limit: 2,
      cursor: first.nextCursor,
    });
    assert.deepEqual(second.orders, normalizedPageOrders.slice(2));
    assert.equal(second.nextCursor, null);

    assert.equal(commands.filter((command) => command[0] === "GET").length, 1);
    const evalCommands = commands.filter((command) => command[0] === "EVAL");
    assert.equal(evalCommands.length, 2);
    assert.equal(evalCommands[0][4], "");
    assert.equal(evalCommands[1][4], references[1]);
    const mgetCommands = commands.filter((command) => command[0] === "MGET");
    assert.equal(mgetCommands.length, 2);
    assert.equal(mgetCommands[0].length, 3);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.KV_REST_API_URL;
    else process.env.KV_REST_API_URL = previousUrl;
    if (previousToken === undefined) delete process.env.KV_REST_API_TOKEN;
    else process.env.KV_REST_API_TOKEN = previousToken;
  }
});

test("legacy numeric offsets are accepted once and continue with keyset cursors", async () => {
  const previousFetch = globalThis.fetch;
  const previousUrl = process.env.KV_REST_API_URL;
  const previousToken = process.env.KV_REST_API_TOKEN;
  let command;
  process.env.KV_REST_API_URL = "https://redis.invalid";
  process.env.KV_REST_API_TOKEN = "unit-token";
  globalThis.fetch = async (_url, init) => {
    command = JSON.parse(init.body);
    return {
      ok: true,
      async json() {
        return { result: [1, "member-after-legacy-offset"] };
      },
    };
  };

  try {
    assert.equal(looksLikeSortedSetCursor("20"), true);
    const page = await listSortedSetPage({
      indexKey: "fiszy:unit:index",
      purpose: "unit.cursor.v1",
      cursor: "20",
      limit: 10,
    });
    assert.deepEqual(page, {
      members: ["member-after-legacy-offset"],
      nextCursor: null,
    });
    assert.equal(command[4], "");
    assert.equal(command[8], 20);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.KV_REST_API_URL;
    else process.env.KV_REST_API_URL = previousUrl;
    if (previousToken === undefined) delete process.env.KV_REST_API_TOKEN;
    else process.env.KV_REST_API_TOKEN = previousToken;
  }
});

test("fulfillment CAS writes the record and a PII-free audit event atomically", async () => {
  const previousFetch = globalThis.fetch;
  const previousUrl = process.env.KV_REST_API_URL;
  const previousToken = process.env.KV_REST_API_TOKEN;
  let command;
  process.env.KV_REST_API_URL = "https://redis.invalid";
  process.env.KV_REST_API_TOKEN = "unit-token";
  globalThis.fetch = async (_url, init) => {
    command = JSON.parse(init.body);
    return {
      ok: true,
      async json() {
        return { result: 1 };
      },
    };
  };

  try {
    const current = defaultOrderFulfillment(order);
    const prepared = prepareFulfillmentPatch(current, {
      expectedRevision: 0,
      status: "shipped",
      tracking: { carrier: "DHL", trackingNumber: "SECRET-TRACKING-123" },
      note: "Internal note with customer context",
    });
    assert.equal(prepared.ok, true);
    if (!prepared.ok) return;

    const result = await updateOrderFulfillment({
      order,
      current,
      patch: prepared.value,
      actorType: "admin_session",
      eventId: "unit-cas-event",
      occurredAt: "2026-08-11T10:02:00.000Z",
    });
    assert.equal(result.outcome, "updated");
    assert.equal(command[0], "EVAL");
    assert.equal(command[2], 6);
    assert.match(command[1], /ZREMRANGEBYSCORE/);
    assert.match(command[1], /EXPIRE/);
    assert.equal(command[15], AUDIT_RETENTION_SECONDS);
    assert.equal(typeof command[16], "number");

    const fulfillmentJson = command[11];
    const auditJson = command[12];
    assert.match(fulfillmentJson, /SECRET-TRACKING-123/);
    assert.match(fulfillmentJson, /Internal note/);
    assert.doesNotMatch(auditJson, /SECRET-TRACKING-123/);
    assert.doesNotMatch(auditJson, /Internal note/);
    assert.doesNotMatch(auditJson, /test@example/);
    assert.doesNotMatch(auditJson, /payment-reference/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) delete process.env.KV_REST_API_URL;
    else process.env.KV_REST_API_URL = previousUrl;
    if (previousToken === undefined) delete process.env.KV_REST_API_TOKEN;
    else process.env.KV_REST_API_TOKEN = previousToken;
  }
});

test("fulfillment e-mail is idempotent and escapes order content", async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.RESEND_API_KEY;
  const previousFrom = process.env.FISZY_EMAIL_FROM;
  let request;
  process.env.RESEND_API_KEY = "re_unit_test";
  process.env.FISZY_EMAIL_FROM = "Fiszy <powiadomienia@fiszy.pl>";
  globalThis.fetch = async (_url, init) => {
    request = init;
    return { ok: true, async json() { return { id: "resend-fulfillment-unit-123" }; } };
  };
  try {
    await sendOrderFulfillmentUpdate({
      email: "client@example.com",
      orderId: "FISZY-ORDER-1",
      product: "Produkt <script>alert(1)</script>",
      status: "shipped",
      revision: 3,
      carrier: "InPost <unsafe>",
      trackingNumber: "TRACK-123",
    });
    const payload = JSON.parse(request.body);
    assert.equal(payload.to[0], "client@example.com");
    assert.doesNotMatch(payload.html, /<script>/);
    assert.match(payload.html, /&lt;script&gt;/);
    assert.match(payload.html, /InPost &lt;unsafe&gt;/);
    assert.match(request.headers["Idempotency-Key"], /^order-fulfillment-v1-[a-f0-9]{64}$/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = previousKey;
    if (previousFrom === undefined) delete process.env.FISZY_EMAIL_FROM; else process.env.FISZY_EMAIL_FROM = previousFrom;
  }
});
