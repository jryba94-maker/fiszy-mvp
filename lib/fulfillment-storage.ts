import {
  AUDIT_RETENTION_SECONDS,
  type AuditActorType,
  type AuditEvent,
  auditEventKey,
  auditIndexKey,
  auditResourceIndexKey,
  createAuditEvent,
  parseStoredAuditEvent,
} from "./audit-storage";
import {
  type AuctionOrder,
  normalizeOrderId,
  orderKey,
} from "./order-storage";
import { redisCommand } from "./redis";
import { listSortedSetPage } from "./sorted-set-pagination";

export const FULFILLMENT_STATUSES = [
  "new",
  "preparing",
  "shipped",
  "delivered",
] as const;

const FULFILLMENT_HISTORY_CURSOR_PURPOSE = "fulfillment.history.v1";

function auditCutoffScore() {
  return Date.now() - AUDIT_RETENTION_SECONDS * 1000;
}

export type FulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number];

export type FulfillmentTracking = {
  carrier: string;
  trackingNumber: string;
};

export type OrderFulfillment = {
  schemaVersion: 1;
  orderId: string;
  auctionId: string;
  runId: string;
  status: FulfillmentStatus;
  revision: number;
  tracking: FulfillmentTracking | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
  shippedAt: string | null;
  deliveredAt: string | null;
};

export type OrderFulfillmentResponse = OrderFulfillment & {
  carrier: string | null;
  trackingNumber: string | null;
};

export type PreparedFulfillmentPatch = {
  expectedRevision: number;
  status: FulfillmentStatus;
  tracking: FulfillmentTracking | null;
  note: string | null;
  trackingChanged: boolean;
  noteChanged: boolean;
};

export type FulfillmentPatchResult =
  | { ok: true; value: PreparedFulfillmentPatch }
  | {
      ok: false;
      outcome: "invalid_request" | "invalid_transition" | "fulfillment_changed";
    };

function environmentName() {
  return process.env.VERCEL_ENV ?? "local";
}

function prefix() {
  return `fiszy:${environmentName()}`;
}

function checkedOrderId(value: string) {
  const orderId = normalizeOrderId(value);
  if (!orderId) throw new Error("Invalid order id.");
  return orderId;
}

export function fulfillmentKey(orderIdValue: string) {
  const orderId = checkedOrderId(orderIdValue);
  return `${prefix()}:order-fulfillment:${encodeURIComponent(orderId)}`;
}

function fulfillmentHistoryIndexKey(orderIdValue: string) {
  const orderId = checkedOrderId(orderIdValue);
  return `${prefix()}:order-fulfillment:${encodeURIComponent(orderId)}:index:v1:history`;
}

function isFulfillmentStatus(value: unknown): value is FulfillmentStatus {
  return (
    typeof value === "string" &&
    (FULFILLMENT_STATUSES as readonly string[]).includes(value)
  );
}

function normalizedTracking(value: unknown): FulfillmentTracking | null | undefined {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.carrier !== "string" ||
    typeof candidate.trackingNumber !== "string"
  ) {
    return undefined;
  }
  const carrier = candidate.carrier.trim();
  const trackingNumber = candidate.trackingNumber.trim();
  if (
    !carrier ||
    carrier.length > 80 ||
    !trackingNumber ||
    trackingNumber.length > 120 ||
    /[\u0000-\u001f\u007f]/.test(carrier) ||
    /[\u0000-\u001f\u007f]/.test(trackingNumber)
  ) {
    return undefined;
  }

  return { carrier, trackingNumber };
}

function normalizedNote(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const note = value.trim();
  if (!note) return null;
  if (
    note.length > 500 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(note)
  ) {
    return undefined;
  }
  return note;
}

function sameTracking(
  left: FulfillmentTracking | null,
  right: FulfillmentTracking | null,
) {
  return (
    left === right ||
    (Boolean(left) &&
      Boolean(right) &&
      left!.carrier === right!.carrier &&
      left!.trackingNumber === right!.trackingNumber)
  );
}

export function isFulfillmentTransitionAllowed(
  current: FulfillmentStatus,
  next: FulfillmentStatus,
) {
  const allowed: Record<FulfillmentStatus, readonly FulfillmentStatus[]> = {
    new: ["new", "preparing", "shipped"],
    preparing: ["new", "preparing", "shipped"],
    shipped: ["preparing", "shipped", "delivered"],
    delivered: ["shipped", "delivered"],
  };
  return allowed[current].includes(next);
}

export function prepareFulfillmentPatch(
  current: OrderFulfillment,
  value: unknown,
): FulfillmentPatchResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, outcome: "invalid_request" };
  }
  const body = value as Record<string, unknown>;
  const hasStatus = Object.prototype.hasOwnProperty.call(body, "status");
  const hasTracking = Object.prototype.hasOwnProperty.call(body, "tracking");
  const hasCarrier = Object.prototype.hasOwnProperty.call(body, "carrier");
  const hasTrackingNumber = Object.prototype.hasOwnProperty.call(
    body,
    "trackingNumber",
  );
  const hasFlatTracking = hasCarrier || hasTrackingNumber;
  const hasNote = Object.prototype.hasOwnProperty.call(body, "note");
  if (
    (!hasStatus && !hasTracking && !hasFlatTracking && !hasNote) ||
    (hasTracking && hasFlatTracking) ||
    hasCarrier !== hasTrackingNumber
  ) {
    return { ok: false, outcome: "invalid_request" };
  }
  if (
    typeof body.expectedRevision !== "number" ||
    !Number.isInteger(body.expectedRevision) ||
    body.expectedRevision < 0
  ) {
    return { ok: false, outcome: "invalid_request" };
  }
  if (body.expectedRevision !== current.revision) {
    return { ok: false, outcome: "fulfillment_changed" };
  }

  const status = hasStatus ? body.status : current.status;
  if (!isFulfillmentStatus(status)) {
    return { ok: false, outcome: "invalid_request" };
  }
  if (!isFulfillmentTransitionAllowed(current.status, status)) {
    return { ok: false, outcome: "invalid_transition" };
  }

  const tracking = hasTracking
    ? normalizedTracking(body.tracking)
    : hasFlatTracking
      ? normalizedTracking({
          carrier: body.carrier,
          trackingNumber: body.trackingNumber,
        })
      : current.tracking;
  const note = hasNote ? normalizedNote(body.note) : current.note;
  if (tracking === undefined || note === undefined) {
    return { ok: false, outcome: "invalid_request" };
  }
  if ((status === "shipped" || status === "delivered") && !tracking) {
    return { ok: false, outcome: "invalid_request" };
  }

  const trackingChanged = !sameTracking(current.tracking, tracking);
  const noteChanged = current.note !== note;
  if (status === current.status && !trackingChanged && !noteChanged) {
    return { ok: false, outcome: "invalid_request" };
  }

  return {
    ok: true,
    value: {
      expectedRevision: body.expectedRevision,
      status,
      tracking,
      note,
      trackingChanged,
      noteChanged,
    },
  };
}

export function fulfillmentResponse(
  fulfillment: OrderFulfillment,
): OrderFulfillmentResponse {
  return {
    ...fulfillment,
    carrier: fulfillment.tracking?.carrier ?? null,
    trackingNumber: fulfillment.tracking?.trackingNumber ?? null,
  };
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function parseStoredOrderFulfillment(
  raw: unknown,
): OrderFulfillment | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<OrderFulfillment>;
    const orderId = normalizeOrderId(value.orderId);
    const tracking = normalizedTracking(value.tracking);
    if (
      value.schemaVersion !== 1 ||
      !orderId ||
      typeof value.auctionId !== "string" ||
      typeof value.runId !== "string" ||
      !isFulfillmentStatus(value.status) ||
      typeof value.revision !== "number" ||
      !Number.isInteger(value.revision) ||
      value.revision < 1 ||
      tracking === undefined ||
      ((value.status === "shipped" || value.status === "delivered") &&
        !tracking) ||
      (value.note !== null && typeof value.note !== "string") ||
      normalizedNote(value.note) !== value.note ||
      !validTimestamp(value.createdAt) ||
      !validTimestamp(value.updatedAt) ||
      (value.shippedAt !== null && !validTimestamp(value.shippedAt)) ||
      (value.deliveredAt !== null && !validTimestamp(value.deliveredAt))
    ) {
      return null;
    }

    return {
      schemaVersion: 1,
      orderId,
      auctionId: value.auctionId,
      runId: value.runId,
      status: value.status,
      revision: value.revision,
      tracking,
      note: value.note,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
      shippedAt: value.shippedAt,
      deliveredAt: value.deliveredAt,
    };
  } catch {
    return null;
  }
}

export function defaultOrderFulfillment(order: AuctionOrder): OrderFulfillment {
  const orderId = normalizeOrderId(order.orderId);
  if (!orderId || !validTimestamp(order.paidAt)) {
    throw new Error("Stored auction order is invalid.");
  }
  return {
    schemaVersion: 1,
    orderId,
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
  };
}

function assertFulfillmentMatchesOrder(
  fulfillment: OrderFulfillment,
  order: AuctionOrder,
) {
  if (
    fulfillment.orderId !== order.orderId ||
    fulfillment.auctionId !== order.auctionId ||
    fulfillment.runId !== order.runId
  ) {
    throw new Error("Stored fulfillment does not match its order.");
  }
}

export async function readOrderFulfillment(order: AuctionOrder) {
  const raw = await redisCommand<string>([
    "GET",
    fulfillmentKey(order.orderId),
  ]);
  if (raw === null) return defaultOrderFulfillment(order);
  const fulfillment = parseStoredOrderFulfillment(raw);
  if (!fulfillment) throw new Error("Stored fulfillment is invalid.");
  assertFulfillmentMatchesOrder(fulfillment, order);
  return fulfillment;
}

export async function readOrderFulfillments(orders: AuctionOrder[]) {
  if (orders.length === 0) return [];
  const values =
    (await redisCommand<Array<string | null>>([
      "MGET",
      ...orders.map((order) => fulfillmentKey(order.orderId)),
    ])) ?? [];

  return orders.map((order, index) => {
    const raw = values[index] ?? null;
    if (raw === null) return defaultOrderFulfillment(order);
    const fulfillment = parseStoredOrderFulfillment(raw);
    if (!fulfillment) throw new Error("Stored fulfillment is invalid.");
    assertFulfillmentMatchesOrder(fulfillment, order);
    return fulfillment;
  });
}

export async function updateOrderFulfillment(input: {
  order: AuctionOrder;
  current: OrderFulfillment;
  patch: PreparedFulfillmentPatch;
  actorType: AuditActorType;
  eventId?: string;
  occurredAt?: string;
}) {
  assertFulfillmentMatchesOrder(input.current, input.order);
  if (input.patch.expectedRevision !== input.current.revision) {
    return { outcome: "fulfillment_changed" as const };
  }

  const occurredAt = input.occurredAt ?? new Date().toISOString();
  if (!validTimestamp(occurredAt)) throw new Error("Invalid fulfillment time.");
  const next: OrderFulfillment = {
    ...input.current,
    status: input.patch.status,
    revision: input.current.revision + 1,
    tracking: input.patch.tracking,
    note: input.patch.note,
    updatedAt: occurredAt,
    shippedAt:
      input.patch.status === "shipped" || input.patch.status === "delivered"
        ? input.current.shippedAt ?? occurredAt
        : null,
    deliveredAt:
      input.patch.status === "delivered"
        ? input.current.deliveredAt ?? occurredAt
        : null,
  };
  const auditEvent = createAuditEvent(
    {
      actorType: input.actorType,
      action: "order.fulfillment.updated",
      resourceType: "order",
      resourceId: input.order.orderId,
      outcome: "success",
      details: {
        previousStatus: input.current.status,
        status: next.status,
        revision: next.revision,
        trackingChanged: input.patch.trackingChanged,
        noteChanged: input.patch.noteChanged,
        trackingPresent: Boolean(next.tracking),
      },
    },
    { eventId: input.eventId, occurredAt },
  );
  const score = Date.parse(auditEvent.occurredAt);
  const script = `
local orderRaw = redis.call("GET", KEYS[1])
if not orderRaw then return 0 end
local orderOk, order = pcall(cjson.decode, orderRaw)
if not orderOk or type(order) ~= "table" or order.orderId ~= ARGV[1] then return -1 end

local currentRevision = 0
local currentRaw = redis.call("GET", KEYS[2])
if currentRaw then
  local currentOk, current = pcall(cjson.decode, currentRaw)
  if not currentOk or type(current) ~= "table" or type(current.revision) ~= "number" or current.orderId ~= ARGV[1] then
    return -1
  end
  currentRevision = current.revision
end
if currentRevision ~= tonumber(ARGV[2]) then return -2 end

local nextOk, nextValue = pcall(cjson.decode, ARGV[3])
local auditOk, auditValue = pcall(cjson.decode, ARGV[4])
if not nextOk or type(nextValue) ~= "table" or not auditOk or type(auditValue) ~= "table" then return -1 end
if nextValue.orderId ~= order.orderId or nextValue.auctionId ~= order.auctionId or nextValue.runId ~= order.runId then return -1 end
if nextValue.revision ~= currentRevision + 1 then return -1 end
if auditValue.eventId ~= ARGV[6] or auditValue.resourceId ~= order.orderId then return -1 end
if redis.call("EXISTS", KEYS[3]) == 1 then return -3 end

redis.call("SET", KEYS[2], ARGV[3])
redis.call("SET", KEYS[3], ARGV[4], "EX", ARGV[7])
redis.call("ZADD", KEYS[4], ARGV[5], ARGV[6])
redis.call("ZADD", KEYS[5], ARGV[5], ARGV[6])
redis.call("ZADD", KEYS[6], ARGV[5], ARGV[6])
redis.call("ZREMRANGEBYSCORE", KEYS[4], "-inf", ARGV[8])
redis.call("ZREMRANGEBYSCORE", KEYS[5], "-inf", ARGV[8])
redis.call("ZREMRANGEBYSCORE", KEYS[6], "-inf", ARGV[8])
redis.call("EXPIRE", KEYS[5], ARGV[7])
redis.call("EXPIRE", KEYS[6], ARGV[7])
return 1
`;

  const result = await redisCommand<number>([
    "EVAL",
    script,
    6,
    orderKey(input.order.runId, input.order.auctionId),
    fulfillmentKey(input.order.orderId),
    auditEventKey(auditEvent.eventId),
    auditIndexKey(),
    auditResourceIndexKey("order", input.order.orderId),
    fulfillmentHistoryIndexKey(input.order.orderId),
    input.order.orderId,
    input.patch.expectedRevision,
    JSON.stringify(next),
    JSON.stringify(auditEvent),
    score,
    auditEvent.eventId,
    AUDIT_RETENTION_SECONDS,
    auditCutoffScore(),
  ]);

  if (result === 1) {
    return { outcome: "updated" as const, fulfillment: next, auditEvent };
  }
  if (result === 0) return { outcome: "not_found" as const };
  if (result === -2) return { outcome: "fulfillment_changed" as const };
  if (result === -3) return { outcome: "audit_conflict" as const };
  return { outcome: "storage_error" as const };
}

export async function listFulfillmentHistory(input: {
  orderId: string;
  cursor?: string | null;
  limit?: number;
}) {
  const orderId = normalizeOrderId(input.orderId);
  if (!orderId) return null;
  const limit = input.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) return null;
  const indexKey = fulfillmentHistoryIndexKey(orderId);

  const page = await listSortedSetPage({
    indexKey,
    purpose: FULFILLMENT_HISTORY_CURSOR_PURPOSE,
    cursor: input.cursor,
    limit,
    pruneBeforeScore: auditCutoffScore(),
    expireSeconds: AUDIT_RETENTION_SECONDS,
  });
  if (!page) return null;
  const ids = page.members;
  const values = ids.length > 0
    ? ((await redisCommand<Array<string | null>>([
        "MGET",
        ...ids.map((eventId) => auditEventKey(eventId)),
      ])) ?? [])
    : [];
  const history = values
    .map(parseStoredAuditEvent)
    .filter(
      (event): event is AuditEvent =>
        Boolean(
          event &&
            event.action === "order.fulfillment.updated" &&
            event.resourceType === "order" &&
            event.resourceId === orderId,
        ),
    );
  return {
    history,
    nextCursor: page.nextCursor,
  };
}
