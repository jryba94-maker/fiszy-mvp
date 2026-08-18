import type {
  AdminAuction,
  AdminAuctionRun,
  AdminAuditEvent,
  AdminHealth,
  AdminOrder,
  AdminParticipant,
  AdminSession,
  AuctionCategory,
  AuctionDefinitionInput,
  AuctionRecordState,
  AuctionRunStatus,
  AuditDetail,
  CursorPage,
  FulfillmentStatus,
  FulfillmentUpdateInput,
  MutationResult,
  OrderFulfillment,
} from "./types";

type JsonRecord = Record<string, unknown>;

const PAGE_LIMIT = 50;
const MAX_PAGES = 100;

const AUCTION_RECORD_STATES = new Set<AuctionRecordState>([
  "draft",
  "published",
  "archived",
]);
const AUCTION_RUN_STATUSES = new Set<AuctionRunStatus>([
  "waiting",
  "live",
  "payment_pending",
  "sold",
  "ended",
]);
const AUCTION_CATEGORIES = new Set<AuctionCategory>([
  "electronics",
  "home",
  "sport",
  "beauty",
  "gaming",
  "other",
]);
const FULFILLMENT_STATUSES = new Set<FulfillmentStatus>([
  "new",
  "preparing",
  "shipped",
  "delivered",
]);

export class ApiError extends Error {
  status: number;
  outcome: string | null;

  constructor(message: string, status: number, outcome: string | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.outcome = outcome;
  }
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asInteger(value: unknown): number | null {
  const parsed = asNumber(value);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
}

function asBoolean(value: unknown): boolean {
  return value === true;
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    const parsed = asString(value);
    if (parsed) return parsed;
  }
  return null;
}

function firstNumber(...values: unknown[]) {
  for (const value of values) {
    const parsed = asNumber(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function firstInteger(...values: unknown[]) {
  for (const value of values) {
    const parsed = asInteger(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function asCursor(value: unknown) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  return asString(value);
}

function asRecordState(value: unknown): AuctionRecordState | null {
  return typeof value === "string" && AUCTION_RECORD_STATES.has(value as AuctionRecordState)
    ? (value as AuctionRecordState)
    : null;
}

function asRunStatus(value: unknown): AuctionRunStatus | null {
  return typeof value === "string" && AUCTION_RUN_STATUSES.has(value as AuctionRunStatus)
    ? (value as AuctionRunStatus)
    : null;
}

function asFulfillmentStatus(value: unknown): FulfillmentStatus | null {
  return typeof value === "string" && FULFILLMENT_STATUSES.has(value as FulfillmentStatus)
    ? (value as FulfillmentStatus)
    : null;
}

function asAuctionCategory(value: unknown): AuctionCategory | null {
  return typeof value === "string" && AUCTION_CATEGORIES.has(value as AuctionCategory)
    ? (value as AuctionCategory)
    : null;
}

function apiErrorMessage(status: number, payload: JsonRecord) {
  const directMessage = asString(payload.message) ?? asString(payload.error);
  if (directMessage) return directMessage;

  const outcome = asString(payload.outcome);
  switch (outcome) {
    case "unauthorized":
      return "Sesja administratora wygasła. Zaloguj się ponownie.";
    case "admin_not_configured":
      return "Sekret administratora nie jest skonfigurowany.";
    case "invalid_request":
      return "Przesłane dane są nieprawidłowe.";
    case "auction_in_progress":
      return "Nie można wykonać tej operacji, gdy runda jest aktywna.";
    case "auction_archived":
      return "Przywróć aukcję z archiwum przed uruchomieniem rundy.";
    case "auction_changed":
      return "Aukcja została zmieniona w innym oknie. Odśwież dane.";
    case "order_changed":
    case "fulfillment_changed":
      return "Status zamówienia zmienił się w innym oknie. Odśwież dane.";
    case "invalid_transition":
      return "Ta zmiana statusu realizacji nie jest dozwolona.";
    case "pending_payment":
      return "Zwycięzca nadal finalizuje zakup.";
    case "storage_error":
      return "Nie udało się połączyć z magazynem danych.";
    default:
      return status === 404
        ? "Ta funkcja nie jest jeszcze dostępna w API."
        : `Serwer zwrócił błąd ${status}.`;
  }
}

async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text };
  }
}

async function request(
  path: string,
  init: RequestInit = {},
  acceptedErrorStatuses: number[] = [],
) {
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const payload = await readPayload(response);

  if (!response.ok && !acceptedErrorStatuses.includes(response.status)) {
    const record = asRecord(payload);
    throw new ApiError(
      apiErrorMessage(response.status, record),
      response.status,
      asString(record.outcome),
    );
  }

  return { response, payload };
}

function normalizeAuction(value: unknown, index: number): AdminAuction {
  const root = asRecord(value);
  const record = asRecord(root.record);
  const publicAuction = asRecord(root.auction);
  const definition = asRecord(root.definition ?? record.definition);
  const run = asRecord(
    root.activeRun ?? root.currentRun ?? root.latestRun ?? publicAuction,
  );
  const auctionId =
    firstString(
      root.auctionId,
      publicAuction.auctionId,
      record.auctionId,
      root.id,
      root.slug,
    ) ?? `aukcja-${index + 1}`;
  const slug =
    firstString(root.slug, record.slug, root.auctionId, record.auctionId, root.id) ??
    auctionId;
  const productName =
    firstString(
      root.productName,
      root.product,
      root.name,
      publicAuction.productName,
      publicAuction.product,
      record.productName,
      definition.productName,
      definition.product,
    ) ?? "Produkt bez nazwy";
  const legacyStatus = firstString(root.status, publicAuction.status, run.status);
  const recordState =
    asRecordState(root.recordState ?? root.state ?? record.state) ??
    (legacyStatus === "draft" ? "draft" : "published");

  return {
    auctionId,
    slug,
    revision: firstInteger(root.revision, record.revision),
    recordState,
    productName,
    category:
      asAuctionCategory(
        firstString(
          root.category,
          publicAuction.category,
          record.category,
          definition.category,
        ),
      ) ?? "other",
    productImageUrl: firstString(
      root.productImageUrl,
      root.imageUrl,
      publicAuction.productImageUrl,
      publicAuction.imageUrl,
      record.productImageUrl,
      definition.productImageUrl,
      definition.imageUrl,
    ),
    regularPrice:
      firstNumber(
        root.regularPrice,
        publicAuction.regularPrice,
        record.regularPrice,
        definition.regularPrice,
      ) ?? 0,
    startPrice:
      firstNumber(
        root.startPrice,
        publicAuction.startPrice,
        record.startPrice,
        definition.startPrice,
      ) ?? 0,
    floorPrice:
      firstNumber(
        root.floorPrice,
        publicAuction.floorPrice,
        record.floorPrice,
        definition.floorPrice,
      ) ?? 0,
    durationMinutes:
      firstNumber(
        root.durationMinutes,
        publicAuction.durationMinutes,
        record.durationMinutes,
        definition.durationMinutes,
      ) ?? 0,
    status: asRunStatus(legacyStatus),
    currentPrice: firstNumber(
      root.currentPrice,
      publicAuction.currentPrice,
      run.currentPrice,
    ),
    runId: firstString(root.runId, publicAuction.runId, run.runId, run.id),
    startsAt: firstString(root.startsAt, publicAuction.startsAt, run.startsAt),
    endsAt: firstString(root.endsAt, publicAuction.endsAt, run.endsAt),
    soldAt: firstString(root.soldAt, publicAuction.soldAt, run.soldAt),
  };
}

function normalizeFulfillment(
  value: unknown,
  fallback?: Partial<OrderFulfillment>,
): OrderFulfillment {
  const root = asRecord(value);
  const tracking = asRecord(root.tracking);
  return {
    status: asFulfillmentStatus(root.status) ?? fallback?.status ?? "new",
    revision: firstInteger(root.revision) ?? fallback?.revision ?? 1,
    carrier:
      root.tracking === null
        ? null
        : firstString(tracking.carrier, root.carrier) ?? fallback?.carrier ?? null,
    trackingNumber:
      root.tracking === null
        ? null
        : firstString(tracking.trackingNumber, root.trackingNumber) ??
          fallback?.trackingNumber ??
          null,
    note: root.note === null ? null : firstString(root.note) ?? fallback?.note ?? null,
    updatedAt:
      firstString(root.updatedAt, root.changedAt) ??
      fallback?.updatedAt ??
      new Date(0).toISOString(),
  };
}

function normalizeOrder(value: unknown, index: number): AdminOrder {
  const root = asRecord(value);
  const customer = asRecord(root.customer);
  const addressSource = root.shippingAddress ?? root.address;
  const address = addressSource == null ? null : asRecord(addressSource);
  const paidAt = firstString(root.paidAt, root.createdAt) ?? new Date(0).toISOString();

  return {
    orderId: firstString(root.orderId, root.id) ?? `ZAMÓWIENIE-${index + 1}`,
    auctionId: firstString(root.auctionId),
    runId: firstString(root.runId) ?? "—",
    bidderId: firstString(root.bidderId, root.participantId),
    product: firstString(root.product, root.productName) ?? "Produkt",
    amount: firstNumber(root.amount) ?? 0,
    currency: firstString(root.currency) ?? "pln",
    paymentSessionId: firstString(root.paymentSessionId),
    paidAt,
    customer: {
      name: firstString(customer.name, root.customerName),
      email: firstString(customer.email, root.customerEmail),
      phone: firstString(customer.phone, root.customerPhone),
    },
    shippingAddress:
      address === null
        ? null
        : {
            city: firstString(address.city),
            country: firstString(address.country),
            line1: firstString(address.line1),
            line2: firstString(address.line2),
            postalCode: firstString(address.postalCode, address.postal_code),
            state: firstString(address.state),
          },
    fulfillment: normalizeFulfillment(root.fulfillment, { updatedAt: paidAt }),
  };
}

function definitionBody(input: AuctionDefinitionInput) {
  return {
    productName: input.productName,
    productImageUrl: input.productImageUrl,
    category: input.category,
    regularPrice: input.regularPrice,
    startPrice: input.startPrice,
    floorPrice: input.floorPrice,
    durationMinutes: input.durationMinutes,
    ...(input.startsAt ? { startsAt: input.startsAt } : {}),
  };
}

function pagePath(path: string, cursor: string | null, limit = PAGE_LIMIT) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  return `${path}?${params.toString()}`;
}

async function loadAllPages<T>(
  path: string,
  itemKey: string,
  normalize: (value: unknown, index: number) => T,
) {
  const items: T[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { payload } = await request(pagePath(path, cursor));
    const record = asRecord(payload);
    const values = Array.isArray(record[itemKey]) ? record[itemKey] : [];
    items.push(...values.map((value, index) => normalize(value, items.length + index)));

    const nextCursor = asCursor(record.nextCursor);
    if (!nextCursor) return items;
    if (seenCursors.has(nextCursor)) {
      throw new Error("Serwer zwrócił zapętloną paginację.");
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  throw new Error("Panel przerwał pobieranie po osiągnięciu bezpiecznego limitu stron.");
}

export async function getAdminSession(): Promise<AdminSession> {
  const { payload } = await request("/api/admin/session");
  const record = asRecord(payload);
  return {
    configured: asBoolean(record.configured),
    authenticated: asBoolean(record.authenticated),
    role: (["owner", "operator", "support", "viewer"].includes(firstString(record.role) ?? "")
      ? firstString(record.role)
      : "owner") as AdminSession["role"],
    permissions: Array.isArray(record.permissions)
      ? record.permissions.flatMap((value) => typeof value === "string" ? [value] : [])
      : [],
  };
}

export async function createAdminSession(secret: string): Promise<AdminSession> {
  await request("/api/admin/session", {
    method: "POST",
    body: JSON.stringify({ secret }),
  });
  return getAdminSession();
}

export async function deleteAdminSession() {
  await request("/api/admin/session", { method: "DELETE" });
}

export async function loadAuctions(): Promise<{
  auctions: AdminAuction[];
  legacy: boolean;
}> {
  try {
    const auctions = await loadAllPages(
      "/api/admin/auctions",
      "auctions",
      normalizeAuction,
    );
    return { auctions, legacy: false };
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) throw error;

    const { payload } = await request("/api/auction");
    return { auctions: [normalizeAuction(payload, 0)], legacy: true };
  }
}

export async function loadOrders(): Promise<{
  orders: AdminOrder[];
  legacy: boolean;
}> {
  try {
    const orders = await loadAllPages(
      "/api/admin/orders",
      "orders",
      normalizeOrder,
    );
    return { orders, legacy: false };
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) throw error;

    const { payload } = await request("/api/admin/order");
    const record = asRecord(payload);
    return {
      orders: record.order ? [normalizeOrder(record.order, 0)] : [],
      legacy: true,
    };
  }
}

export async function loadHealth(): Promise<AdminHealth> {
  const { response, payload } = await request(
    "/api/admin/health",
    {},
    [503],
  );
  const record = asRecord(payload);

  return {
    environment: firstString(record.environment) ?? "unknown",
    adminConfigured: asBoolean(
      record.adminConfigured ?? record.adminSecretConfigured,
    ),
    adminSecretStrong: asBoolean(
      record.adminSecretStrong ?? record.adminConfigured ?? record.adminSecretConfigured,
    ),
    redisConfigured: asBoolean(record.redisConfigured),
    redisReachable: asBoolean(record.redisReachable ?? record.redisConfigured),
    redisLatencyMs: firstNumber(record.redisLatencyMs),
    paymentProvider: firstString(record.paymentProvider) ?? "stripe",
    paymentConfigured: asBoolean(record.paymentConfigured ?? record.stripeConfigured),
    paymentTestMode: asBoolean(record.paymentTestMode ?? record.stripeTestMode),
    paymentWebhookConfigured: asBoolean(
      record.paymentWebhookConfigured ??
      record.webhookConfigured ??
      record.stripeWebhookConfigured,
    ),
    authenticationConfigured: asBoolean(record.authenticationConfigured),
    emailDeliveryConfigured: asBoolean(record.emailDeliveryConfigured),
    inAppNotificationsConfigured: asBoolean(record.inAppNotificationsConfigured),
    externalErrorAlertsConfigured: asBoolean(record.externalErrorAlertsConfigured),
    canonicalSiteUrl: firstString(record.canonicalSiteUrl),
    canonicalSiteUrlExplicit: asBoolean(record.canonicalSiteUrlExplicit),
    degraded:
      response.status === 503 ||
      record.healthy === false ||
      asBoolean(record.degraded),
  };
}

export async function createAuction(
  input: AuctionDefinitionInput,
): Promise<MutationResult> {
  try {
    const { payload } = await request("/api/admin/auctions", {
      method: "POST",
      body: JSON.stringify({
        ...definitionBody(input),
        auctionId: input.slug,
        slug: input.slug,
        state: input.startsAt ? "published" : "draft",
      }),
    });
    return { legacy: false, message: asString(asRecord(payload).message) ?? undefined };
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) throw error;

    await request("/api/admin/auction/start", {
      method: "POST",
      body: JSON.stringify(definitionBody(input)),
    });
    return { legacy: true };
  }
}

export async function updateAuction(
  auctionId: string,
  input: AuctionDefinitionInput,
  expectedRevision?: number,
): Promise<MutationResult> {
  const { payload } = await request(
    `/api/admin/auctions/${encodeURIComponent(auctionId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        ...definitionBody(input),
        ...(expectedRevision !== undefined ? { expectedRevision } : {}),
      }),
    },
  );
  return { legacy: false, message: asString(asRecord(payload).message) ?? undefined };
}

export async function setAuctionRecordState(
  auctionId: string,
  state: AuctionRecordState,
  expectedRevision?: number,
) {
  const { payload } = await request(
    `/api/admin/auctions/${encodeURIComponent(auctionId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        state,
        ...(expectedRevision !== undefined ? { expectedRevision } : {}),
      }),
    },
  );
  return {
    message: asString(asRecord(payload).message) ?? undefined,
  };
}

export async function startAuctionRun(
  auction: AdminAuction,
  startsAt?: string,
): Promise<MutationResult> {
  const input: AuctionDefinitionInput = {
    auctionId: auction.auctionId,
    slug: auction.slug,
    productName: auction.productName,
    productImageUrl: auction.productImageUrl,
    category: auction.category,
    regularPrice: auction.regularPrice,
    startPrice: auction.startPrice,
    floorPrice: auction.floorPrice,
    durationMinutes: auction.durationMinutes,
    ...(startsAt ? { startsAt } : {}),
  };
  const body = {
    ...definitionBody(input),
    ...(auction.revision !== null ? { expectedRevision: auction.revision } : {}),
  };

  try {
    const { payload } = await request(
      `/api/admin/auctions/${encodeURIComponent(auction.auctionId)}/runs`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    );
    return { legacy: false, message: asString(asRecord(payload).message) ?? undefined };
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 404) throw error;

    await request("/api/admin/auction/start", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return { legacy: true };
  }
}

export async function updateOrderFulfillment(
  orderId: string,
  input: FulfillmentUpdateInput,
): Promise<OrderFulfillment> {
  const tracking = input.carrier && input.trackingNumber
    ? { carrier: input.carrier, trackingNumber: input.trackingNumber }
    : null;
  const { payload } = await request(
    `/api/admin/orders/${encodeURIComponent(orderId)}/fulfillment`,
    {
      method: "PATCH",
      body: JSON.stringify({
        expectedRevision: input.expectedRevision,
        status: input.status,
        tracking,
        note: input.note,
      }),
    },
  );
  const root = asRecord(payload);
  const order = asRecord(root.order);
  const fallback: OrderFulfillment = {
    status: input.status,
    revision: input.expectedRevision + 1,
    carrier: input.carrier,
    trackingNumber: input.trackingNumber,
    note: input.note,
    updatedAt: new Date().toISOString(),
  };
  return normalizeFulfillment(root.fulfillment ?? order.fulfillment, fallback);
}

function normalizeRun(value: unknown, auctionId: string, index: number): AdminAuctionRun {
  const root = asRecord(value);
  const config = asRecord(root.config ?? root.run);
  const winner = asRecord(root.winner);
  const paymentStatus = firstString(winner.paymentStatus, root.paymentStatus);
  const inferredStatus = paymentStatus === "paid"
    ? "sold"
    : paymentStatus === "pending"
      ? "payment_pending"
      : null;

  return {
    auctionId: firstString(root.auctionId) ?? auctionId,
    runId: firstString(root.runId, root.id, config.runId) ?? `runda-${index + 1}`,
    status: asRunStatus(root.status ?? config.status) ?? inferredStatus,
    startsAt: firstString(root.startsAt, config.startsAt),
    endsAt: firstString(root.endsAt, config.endsAt),
    startPrice: firstNumber(root.startPrice, config.startPrice),
    floorPrice: firstNumber(root.floorPrice, config.floorPrice),
    soldPrice: firstNumber(root.soldPrice, root.price, winner.price),
    participantCount: firstInteger(root.participantCount, root.participantsCount),
    winnerParticipantId: firstString(
      root.winnerParticipantId,
      winner.participantId,
      winner.bidderId,
    ),
    winnerClaimedAt: firstString(root.winnerClaimedAt, winner.claimedAt),
    paidAt: firstString(root.paidAt, winner.paidAt),
  };
}

function normalizeParticipant(value: unknown, index: number): AdminParticipant {
  const root = asRecord(value);
  const entryStatusValue = firstString(root.entryStatus);
  const entryStatus = entryStatusValue === "granted" || entryStatusValue === "refunded"
    ? entryStatusValue
    : "unknown";

  return {
    participantId:
      firstString(root.participantId, root.bidderId, root.id) ?? `uczestnik-${index + 1}`,
    auctionId: firstString(root.auctionId),
    runId: firstString(root.runId),
    entryStatus,
    entryFee: firstNumber(root.entryFee, root.fee),
    grantedAt: firstString(root.grantedAt),
    refundedAt: firstString(root.refundedAt),
    isWinner: asBoolean(root.isWinner ?? root.winner),
    winnerPrice: firstNumber(root.winnerPrice, root.price),
  };
}

function normalizeAuditDetails(value: unknown) {
  const record = asRecord(value);
  return Object.fromEntries(
    Object.entries(record).flatMap(([key, detail]) => {
      if (
        detail === null ||
        typeof detail === "string" ||
        typeof detail === "number" ||
        typeof detail === "boolean"
      ) {
        return [[key, detail as AuditDetail]];
      }
      return [];
    }),
  );
}

function normalizeAuditEvent(value: unknown, index: number): AdminAuditEvent {
  const root = asRecord(value);
  const timestamp =
    firstString(root.timestamp, root.createdAt, root.occurredAt) ?? new Date(0).toISOString();
  return {
    eventId: firstString(root.eventId, root.id) ?? `${timestamp}-${index}`,
    event: firstString(root.event, root.action, root.type) ?? "unknown_event",
    timestamp,
    actor: firstString(root.actor, root.actorId),
    entityType: firstString(root.entityType, root.resourceType),
    entityId: firstString(root.entityId, root.resourceId, root.auctionId, root.orderId),
    details: normalizeAuditDetails(root.details ?? root.metadata),
  };
}

export async function loadAuctionRunsPage(
  auctionId: string,
  cursor: string | null = null,
): Promise<CursorPage<AdminAuctionRun>> {
  const { payload } = await request(
    pagePath(`/api/admin/auctions/${encodeURIComponent(auctionId)}/runs`, cursor, 20),
  );
  const root = asRecord(payload);
  const values = Array.isArray(root.runs) ? root.runs : [];
  return {
    items: values.map((value, index) => normalizeRun(value, auctionId, index)),
    nextCursor: asCursor(root.nextCursor),
  };
}

export async function loadRunParticipantsPage(
  auctionId: string,
  runId: string,
  cursor: string | null = null,
): Promise<CursorPage<AdminParticipant>> {
  const { payload } = await request(
    pagePath(
      `/api/admin/auctions/${encodeURIComponent(auctionId)}/runs/${encodeURIComponent(runId)}/participants`,
      cursor,
      50,
    ),
  );
  const root = asRecord(payload);
  const values = Array.isArray(root.participants) ? root.participants : [];
  return {
    items: values.map(normalizeParticipant),
    nextCursor: asCursor(root.nextCursor),
  };
}

export async function loadAuditPage(
  cursor: string | null = null,
): Promise<CursorPage<AdminAuditEvent>> {
  const { payload } = await request(pagePath("/api/admin/audit", cursor, 30));
  const root = asRecord(payload);
  const values = Array.isArray(root.events) ? root.events : [];
  return {
    items: values.map(normalizeAuditEvent),
    nextCursor: asCursor(root.nextCursor),
  };
}
