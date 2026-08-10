import type {
  AdminAuction,
  AdminHealth,
  AdminOrder,
  AdminSession,
  AuctionDefinitionInput,
  AuctionStatus,
  MutationResult,
} from "./types";

type JsonRecord = Record<string, unknown>;

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

const VALID_STATUSES = new Set<AuctionStatus>([
  "draft",
  "waiting",
  "live",
  "payment_pending",
  "sold",
  "ended",
]);

function asStatus(value: unknown): AuctionStatus {
  return typeof value === "string" && VALID_STATUSES.has(value as AuctionStatus)
    ? (value as AuctionStatus)
    : "draft";
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
      return "Dane formularza są nieprawidłowe.";
    case "auction_in_progress":
      return "Nie można uruchomić rundy, gdy aukcja jest aktywna.";
    case "auction_changed":
      return "Aukcja została zmieniona w innym oknie. Odśwież dane.";
    case "pending_payment":
      return "Zwycięzca nadal ma aktywną płatność.";
    case "storage_error":
      return "Nie udało się połączyć z bazą danych.";
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

  return {
    auctionId,
    slug,
    revision: firstNumber(root.revision, record.revision),
    productName,
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
    status: asStatus(root.status ?? publicAuction.status ?? run.status),
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

function normalizeOrder(value: unknown, index: number): AdminOrder {
  const root = asRecord(value);
  const customer = asRecord(root.customer);
  const addressSource = root.shippingAddress ?? root.address;
  const address = addressSource == null ? null : asRecord(addressSource);

  return {
    orderId:
      firstString(root.orderId, root.id) ?? `ZAMÓWIENIE-${index + 1}`,
    auctionId: firstString(root.auctionId),
    runId: firstString(root.runId) ?? "—",
    bidderId: firstString(root.bidderId),
    product: firstString(root.product, root.productName) ?? "Produkt",
    amount: firstNumber(root.amount) ?? 0,
    currency: firstString(root.currency) ?? "pln",
    paymentSessionId: firstString(root.paymentSessionId),
    paidAt: firstString(root.paidAt, root.createdAt) ?? new Date(0).toISOString(),
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
  };
}

function definitionBody(input: AuctionDefinitionInput) {
  return {
    productName: input.productName,
    productImageUrl: input.productImageUrl,
    regularPrice: input.regularPrice,
    startPrice: input.startPrice,
    floorPrice: input.floorPrice,
    durationMinutes: input.durationMinutes,
    ...(input.startsAt ? { startsAt: input.startsAt } : {}),
  };
}

export async function getAdminSession(): Promise<AdminSession> {
  const { payload } = await request("/api/admin/session");
  const record = asRecord(payload);
  return {
    configured: asBoolean(record.configured),
    authenticated: asBoolean(record.authenticated),
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
    const { payload } = await request("/api/admin/auctions");
    const record = asRecord(payload);
    const values = Array.isArray(record.auctions) ? record.auctions : [];
    return {
      auctions: values.map(normalizeAuction),
      legacy: false,
    };
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
    const { payload } = await request("/api/admin/orders");
    const record = asRecord(payload);
    const values = Array.isArray(record.orders) ? record.orders : [];
    return {
      orders: values.map(normalizeOrder),
      legacy: false,
    };
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
    stripeConfigured: asBoolean(record.stripeConfigured),
    stripeTestMode: asBoolean(record.stripeTestMode),
    webhookConfigured: asBoolean(
      record.webhookConfigured ?? record.stripeWebhookConfigured,
    ),
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
        auctionId: input.slug,
        slug: input.slug,
        ...(expectedRevision ? { expectedRevision } : {}),
      }),
    },
  );
  return { legacy: false, message: asString(asRecord(payload).message) ?? undefined };
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
    regularPrice: auction.regularPrice,
    startPrice: auction.startPrice,
    floorPrice: auction.floorPrice,
    durationMinutes: auction.durationMinutes,
    ...(startsAt ? { startsAt } : {}),
  };
  const body = {
    ...definitionBody(input),
    ...(auction.revision ? { expectedRevision: auction.revision } : {}),
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
