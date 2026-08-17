import { randomUUID } from "node:crypto";
import { redisCommand } from "./redis";
import { listSortedSetPage } from "./sorted-set-pagination";

export type AuditActorType = "admin_session" | "admin_api" | "system";
export type AuditOutcome = "success" | "failure";
export type AuditDetailValue = string | number | boolean | null;
export type AuditDetails = Record<string, AuditDetailValue>;
export type AuditAction =
  | "order.fulfillment.updated"
  | "auction.created"
  | "auction.updated"
  | "auction.run.scheduled"
  | "account.access.updated"
  | "support.ticket.updated";

export type AuditEvent = {
  schemaVersion: 1;
  eventId: string;
  occurredAt: string;
  actorType: AuditActorType;
  action: AuditAction;
  resourceType: string;
  resourceId: string;
  outcome: AuditOutcome;
  details: AuditDetails;
};

const EVENT_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,118}[A-Za-z0-9])?$/;
const NAME_PATTERN = /^[a-z][a-z0-9_.-]{0,79}$/;
const RUN_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,118}[A-Za-z0-9])?$/;
const RECORD_STATES = new Set(["draft", "published", "archived"]);
const FULFILLMENT_STATUSES = new Set([
  "new",
  "preparing",
  "shipped",
  "delivered",
]);
const ACCOUNT_STATUSES = new Set(["active", "blocked"]);
const TICKET_STATUSES = new Set(["open", "in_progress", "resolved"]);

export const AUDIT_RETENTION_SECONDS = 180 * 24 * 60 * 60;
const AUDIT_CURSOR_PURPOSE = "audit.events.v1";

const ACTION_RESOURCE_TYPES: Record<AuditAction, string> = {
  "order.fulfillment.updated": "order",
  "auction.created": "auction",
  "auction.updated": "auction",
  "auction.run.scheduled": "auction",
  "account.access.updated": "account",
  "support.ticket.updated": "support_ticket",
};

function auditCutoffScore() {
  return Date.now() - AUDIT_RETENTION_SECONDS * 1000;
}

function environmentName() {
  return process.env.VERCEL_ENV ?? "local";
}

function prefix() {
  return `fiszy:${environmentName()}`;
}

function normalizedEventId(value: unknown) {
  if (typeof value !== "string") return null;
  const eventId = value.trim();
  return EVENT_ID_PATTERN.test(eventId) ? eventId : null;
}

export function normalizeAuditResourceType(value: unknown) {
  if (typeof value !== "string") return null;
  const resourceType = value.trim();
  return NAME_PATTERN.test(resourceType) ? resourceType : null;
}

export function normalizeAuditResourceId(value: unknown) {
  if (typeof value !== "string") return null;
  const resourceId = value.trim();
  if (
    !resourceId ||
    resourceId.length > 200 ||
    /[\u0000-\u001f\u007f]/.test(resourceId)
  ) {
    return null;
  }
  return resourceId;
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]) {
  const keys = Object.keys(value).sort();
  return (
    keys.length === expected.length &&
    keys.every((key, index) => key === [...expected].sort()[index])
  );
}

function isRevision(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isIsoTimestamp(value: unknown) {
  return (
    typeof value === "string" &&
    value.length <= 40 &&
    Number.isFinite(Date.parse(value))
  );
}

function normalizeAuditAction(value: unknown): AuditAction | null {
  return typeof value === "string" && Object.hasOwn(ACTION_RESOURCE_TYPES, value)
    ? (value as AuditAction)
    : null;
}

function normalizeAuditDetails(
  action: AuditAction,
  value: unknown,
): AuditDetails | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const details = value as Record<string, unknown>;

  if (action === "order.fulfillment.updated") {
    const keys = [
      "noteChanged",
      "previousStatus",
      "revision",
      "status",
      "trackingChanged",
      "trackingPresent",
    ];
    if (
      !hasExactKeys(details, keys) ||
      !FULFILLMENT_STATUSES.has(String(details.previousStatus)) ||
      !FULFILLMENT_STATUSES.has(String(details.status)) ||
      !isRevision(details.revision) ||
      typeof details.trackingChanged !== "boolean" ||
      typeof details.noteChanged !== "boolean" ||
      typeof details.trackingPresent !== "boolean"
    ) {
      return null;
    }
  } else if (action === "auction.created") {
    if (
      !hasExactKeys(details, ["revision", "scheduled", "state"]) ||
      !RECORD_STATES.has(String(details.state)) ||
      typeof details.scheduled !== "boolean" ||
      !isRevision(details.revision)
    ) {
      return null;
    }
  } else if (action === "auction.updated") {
    if (
      !hasExactKeys(details, [
        "definitionChanged",
        "previousState",
        "revision",
        "state",
      ]) ||
      !RECORD_STATES.has(String(details.previousState)) ||
      !RECORD_STATES.has(String(details.state)) ||
      !isRevision(details.revision) ||
      typeof details.definitionChanged !== "boolean"
    ) {
      return null;
    }
  } else if (action === "account.access.updated") {
    if (
      !hasExactKeys(details, ["noteChanged", "previousStatus", "revision", "status"]) ||
      !ACCOUNT_STATUSES.has(String(details.previousStatus)) ||
      !ACCOUNT_STATUSES.has(String(details.status)) ||
      typeof details.noteChanged !== "boolean" ||
      !isRevision(details.revision)
    ) return null;
  } else if (action === "support.ticket.updated") {
    if (
      !hasExactKeys(details, ["previousStatus", "responseChanged", "revision", "status"]) ||
      !TICKET_STATUSES.has(String(details.previousStatus)) ||
      !TICKET_STATUSES.has(String(details.status)) ||
      typeof details.responseChanged !== "boolean" ||
      !isRevision(details.revision)
    ) return null;
  } else if (
    !hasExactKeys(details, ["revision", "runId", "startsAt"]) ||
    typeof details.runId !== "string" ||
    !RUN_ID_PATTERN.test(details.runId) ||
    !isIsoTimestamp(details.startsAt) ||
    !isRevision(details.revision)
  ) {
    return null;
  }

  return details as AuditDetails;
}

export function parseStoredAuditEvent(raw: unknown): AuditEvent | null {
  if (typeof raw !== "string" || !raw) return null;

  try {
    const value = JSON.parse(raw) as Partial<AuditEvent>;
    const eventId = normalizedEventId(value.eventId);
    const action = normalizeAuditAction(value.action);
    const resourceType = normalizeAuditResourceType(value.resourceType);
    const resourceId = normalizeAuditResourceId(value.resourceId);
    const details = action ? normalizeAuditDetails(action, value.details) : null;
    if (
      value.schemaVersion !== 1 ||
      !eventId ||
      typeof value.occurredAt !== "string" ||
      !Number.isFinite(Date.parse(value.occurredAt)) ||
      (value.actorType !== "admin_session" &&
        value.actorType !== "admin_api" &&
        value.actorType !== "system") ||
      !action ||
      !resourceType ||
      resourceType !== ACTION_RESOURCE_TYPES[action] ||
      !resourceId ||
      (value.outcome !== "success" && value.outcome !== "failure") ||
      !details
    ) {
      return null;
    }

    return {
      schemaVersion: 1,
      eventId,
      occurredAt: value.occurredAt,
      actorType: value.actorType,
      action,
      resourceType,
      resourceId,
      outcome: value.outcome,
      details,
    };
  } catch {
    return null;
  }
}

export function createAuditEvent(
  input: Omit<AuditEvent, "schemaVersion" | "eventId" | "occurredAt">,
  options: { eventId?: string; occurredAt?: string } = {},
) {
  const candidate: AuditEvent = {
    schemaVersion: 1,
    eventId: options.eventId ?? randomUUID(),
    occurredAt: options.occurredAt ?? new Date().toISOString(),
    ...input,
  };
  const event = parseStoredAuditEvent(JSON.stringify(candidate));
  if (!event) throw new Error("Invalid audit event.");
  return event;
}

export function auditEventKey(eventIdValue: string) {
  const eventId = normalizedEventId(eventIdValue);
  if (!eventId) throw new Error("Invalid audit event id.");
  return `${prefix()}:audit:event:${eventId}`;
}

export function auditIndexKey() {
  return `${prefix()}:index:v1:audit`;
}

export function auditResourceIndexKey(
  resourceTypeValue: string,
  resourceIdValue: string,
) {
  const resourceType = normalizeAuditResourceType(resourceTypeValue);
  const resourceId = normalizeAuditResourceId(resourceIdValue);
  if (!resourceType || !resourceId) {
    throw new Error("Invalid audit resource.");
  }
  return `${prefix()}:audit:resource:${resourceType}:${encodeURIComponent(resourceId)}:index:v1:events`;
}

export async function appendAuditEvent(event: AuditEvent) {
  const normalized = parseStoredAuditEvent(JSON.stringify(event));
  if (!normalized) throw new Error("Invalid audit event.");
  const score = Date.parse(normalized.occurredAt);
  const cutoff = auditCutoffScore();
  const script = `
if redis.call("EXISTS", KEYS[1]) == 1 then return 0 end
redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[4])
redis.call("ZADD", KEYS[2], ARGV[2], ARGV[3])
redis.call("ZADD", KEYS[3], ARGV[2], ARGV[3])
redis.call("ZREMRANGEBYSCORE", KEYS[2], "-inf", ARGV[5])
redis.call("ZREMRANGEBYSCORE", KEYS[3], "-inf", ARGV[5])
redis.call("EXPIRE", KEYS[3], ARGV[4])
return 1
`;

  return redisCommand<number>([
    "EVAL",
    script,
    3,
    auditEventKey(normalized.eventId),
    auditIndexKey(),
    auditResourceIndexKey(normalized.resourceType, normalized.resourceId),
    JSON.stringify(normalized),
    score,
    normalized.eventId,
    AUDIT_RETENTION_SECONDS,
    cutoff,
  ]);
}

export async function listAuditEvents(input: {
  cursor?: string | null;
  limit?: number;
  resourceType?: string | null;
  resourceId?: string | null;
}) {
  const limit = input.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) return null;

  const hasResourceType = input.resourceType !== undefined && input.resourceType !== null;
  const hasResourceId = input.resourceId !== undefined && input.resourceId !== null;
  if (hasResourceType !== hasResourceId) return null;

  let indexKey = auditIndexKey();
  let selectedResourceType: string | null = null;
  let selectedResourceId: string | null = null;
  if (hasResourceType && hasResourceId) {
    const resourceType = normalizeAuditResourceType(input.resourceType);
    const resourceId = normalizeAuditResourceId(input.resourceId);
    if (!resourceType || !resourceId) return null;
    indexKey = auditResourceIndexKey(resourceType, resourceId);
    selectedResourceType = resourceType;
    selectedResourceId = resourceId;
  }

  const page = await listSortedSetPage({
    indexKey,
    purpose: AUDIT_CURSOR_PURPOSE,
    cursor: input.cursor,
    limit,
    pruneBeforeScore: auditCutoffScore(),
    expireSeconds: hasResourceType ? AUDIT_RETENTION_SECONDS : undefined,
  });
  if (!page) return null;
  const ids = page.members.filter((eventId) => normalizedEventId(eventId));
  const values = ids.length > 0
    ? ((await redisCommand<Array<string | null>>([
        "MGET",
        ...ids.map((eventId) => auditEventKey(eventId)),
      ])) ?? [])
    : [];
  const events = values
    .map(parseStoredAuditEvent)
    .filter(
      (event): event is AuditEvent =>
        Boolean(
          event &&
            (!hasResourceType ||
              (event.resourceType === selectedResourceType &&
                event.resourceId === selectedResourceId)),
        ),
    );

  return {
    events,
    nextCursor: page.nextCursor,
  };
}
