export const LEGACY_AUCTION_ID = "demo-airpods-pro-1";

export type AuctionStatus =
  | "waiting"
  | "live"
  | "ended"
  | "payment_pending"
  | "sold";

export type AuctionCategory =
  | "electronics"
  | "home"
  | "sport"
  | "beauty"
  | "gaming"
  | "other";

export type PostAuctionOffer = {
  enabled: boolean;
  validityDays: number;
  inventory: number | null;
};

const AUCTION_CATEGORIES = new Set<AuctionCategory>([
  "electronics",
  "home",
  "sport",
  "beauty",
  "gaming",
  "other",
]);

export function auctionCategoryLabel(category: AuctionCategory) {
  if (category === "electronics") return "Elektronika";
  if (category === "home") return "Dom";
  if (category === "sport") return "Sport";
  if (category === "beauty") return "Uroda";
  if (category === "gaming") return "Gaming";
  return "Pozostałe";
}

function inferredCategory(product: string): AuctionCategory {
  const name = product.toLocaleLowerCase("pl-PL");
  if (/airpods|iphone|telefon|laptop|słuch|smart|tablet|elektr/.test(name)) return "electronics";
  if (/playstation|xbox|nintendo|konsol|gaming|gra /.test(name)) return "gaming";
  if (/dom|kuch|odkurz|ekspres|mebl|lampa/.test(name)) return "home";
  if (/rower|buty|sport|fitness|zegarek/.test(name)) return "sport";
  if (/kosmet|perfum|urod|włos/.test(name)) return "beauty";
  return "other";
}

export type PublicAuction = {
  auctionId: string;
  runId: string;
  product: string;
  productImageUrl: string | null;
  category: AuctionCategory;
  postAuctionOffer: PostAuctionOffer;
  regularPrice: number;
  startPrice: number;
  floorPrice: number;
  currentPrice: number;
  entryFee: number;
  durationMinutes: number;
  status: AuctionStatus;
  startsAt: string;
  endsAt: string;
  soldAt: string | null;
  paymentExpiresAt: string | null;
  storageReady: boolean;
  serverTime: string;
};

export type EntryResponse = {
  outcome: string;
  runId?: string;
  hasEntry?: boolean;
  entryFee?: number;
  checkoutUrl?: string | null;
};

export type BuyResponse = {
  outcome: string;
  price?: number;
  currentPrice?: number;
  winnerPrice?: number | null;
  checkoutUrl?: string | null;
};

export type CancelPurchaseResponse = {
  outcome: string;
};

export class PublicApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly outcome?: string,
  ) {
    super(message);
    this.name = "PublicApiError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function optionalDate(value: unknown) {
  const candidate = text(value);
  return candidate && Number.isFinite(Date.parse(candidate)) ? candidate : null;
}

const AUCTION_STATUSES = new Set<AuctionStatus>([
  "waiting",
  "live",
  "ended",
  "payment_pending",
  "sold",
]);

export function normalizeAuction(
  value: unknown,
  fallbackAuctionId?: string,
): PublicAuction | null {
  if (!isRecord(value)) return null;

  const auctionId = text(value.auctionId) ?? fallbackAuctionId ?? null;
  const runId = text(value.runId);
  const product = text(value.product) ?? text(value.productName) ?? "Aukcja Fiszy";
  const categoryValue = text(value.category) as AuctionCategory | null;
  const category = categoryValue && AUCTION_CATEGORIES.has(categoryValue)
    ? categoryValue
    : inferredCategory(product);
  const startsAt = optionalDate(value.startsAt);
  const endsAt = optionalDate(value.endsAt);
  const status = text(value.status) as AuctionStatus | null;
  const startPrice = finiteNumber(value.startPrice);
  const floorPrice = finiteNumber(value.floorPrice);
  const regularPrice = finiteNumber(value.regularPrice);
  const currentPrice = finiteNumber(value.currentPrice);
  const offerValue = isRecord(value.postAuctionOffer)
    ? value.postAuctionOffer
    : null;
  const offerValidityDays = offerValue
    ? finiteNumber(offerValue.validityDays)
    : null;
  const offerInventory = offerValue?.inventory === null
    ? null
    : offerValue
      ? finiteNumber(offerValue.inventory)
      : null;

  if (
    !auctionId ||
    !runId ||
    !startsAt ||
    !endsAt ||
    !status ||
    !AUCTION_STATUSES.has(status) ||
    startPrice === null ||
    floorPrice === null ||
    regularPrice === null ||
    currentPrice === null
  ) {
    return null;
  }

  const explicitDuration = finiteNumber(value.durationMinutes);
  const inferredDuration = Math.max(
    1,
    Math.round((Date.parse(endsAt) - Date.parse(startsAt)) / 60_000),
  );

  return {
    auctionId,
    runId,
    product,
    productImageUrl: text(value.productImageUrl),
    category,
    postAuctionOffer: {
      enabled: offerValue?.enabled === true,
      validityDays:
        offerValidityDays !== null && Number.isInteger(offerValidityDays)
          ? offerValidityDays
          : 7,
      inventory:
        offerValue?.inventory === null ||
        (offerInventory !== null && Number.isInteger(offerInventory))
          ? offerInventory
          : null,
    },
    regularPrice,
    startPrice,
    floorPrice,
    currentPrice,
    entryFee: finiteNumber(value.entryFee) ?? 5,
    durationMinutes: explicitDuration ?? inferredDuration,
    status,
    startsAt,
    endsAt,
    soldAt: optionalDate(value.soldAt),
    paymentExpiresAt: optionalDate(value.paymentExpiresAt),
    storageReady: value.storageReady !== false,
    serverTime: optionalDate(value.serverTime) ?? new Date().toISOString(),
  };
}

async function responseJson(response: Response) {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

function outcomeFrom(value: unknown) {
  return isRecord(value) && typeof value.outcome === "string"
    ? value.outcome
    : undefined;
}

async function checkedJson(response: Response) {
  const data = await responseJson(response);
  if (!response.ok) {
    throw new PublicApiError(
      "Nie udało się pobrać danych aukcji.",
      response.status,
      outcomeFrom(data),
    );
  }
  return data;
}

export async function fetchAuctionIndex(
  cursor?: string | null,
  signal?: AbortSignal,
) {
  const search = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const response = await fetch(`/api/auctions${search}`, {
    cache: "no-store",
    signal,
  });
  const data = await checkedJson(response);

  if (!isRecord(data) || data.outcome !== "ok" || !Array.isArray(data.auctions)) {
    throw new PublicApiError("Serwer zwrócił niepełny katalog aukcji.", 502);
  }

  return {
    auctions: data.auctions
      .map((auction) => normalizeAuction(auction))
      .filter((auction): auction is PublicAuction => Boolean(auction)),
    nextCursor: text(data.nextCursor),
  };
}

export async function fetchLegacyAuction(signal?: AbortSignal) {
  const response = await fetch("/api/auction", { cache: "no-store", signal });
  const data = await checkedJson(response);
  const auction = normalizeAuction(data, LEGACY_AUCTION_ID);
  if (!auction) {
    throw new PublicApiError("Nie udało się odczytać aukcji testowej.", 502);
  }
  return auction;
}

export async function fetchAuctionDetail(
  auctionId: string,
  signal?: AbortSignal,
) {
  const response = await fetch(`/api/auctions/${encodeURIComponent(auctionId)}`, {
    cache: "no-store",
    signal,
  });

  if (response.status === 404 && auctionId === LEGACY_AUCTION_ID) {
    return fetchLegacyAuction(signal);
  }

  const data = await checkedJson(response);
  if (!isRecord(data) || data.outcome !== "ok") {
    throw new PublicApiError("Serwer zwrócił niepełne dane aukcji.", 502);
  }

  const auction = normalizeAuction(data.auction, auctionId);
  if (!auction) {
    throw new PublicApiError("Serwer zwrócił niepełne dane aukcji.", 502);
  }
  return auction;
}

function dynamicRunPath(auctionId: string, runId: string, suffix: string) {
  return `/api/auctions/${encodeURIComponent(auctionId)}/runs/${encodeURIComponent(runId)}/${suffix}`;
}

async function requestWithLegacyFallback(
  auctionId: string,
  dynamicUrl: string,
  legacyUrl: string,
  init: RequestInit,
) {
  let response = await fetch(dynamicUrl, init);
  if (response.status === 404 && auctionId === LEGACY_AUCTION_ID) {
    response = await fetch(legacyUrl, init);
  }
  const data = await responseJson(response);
  if (!isRecord(data)) {
    throw new PublicApiError("Serwer zwrócił nieprawidłową odpowiedź.", response.status);
  }
  return data;
}

export async function fetchEntryState(
  auctionId: string,
  runId: string,
) {
  return (await requestWithLegacyFallback(
    auctionId,
    dynamicRunPath(auctionId, runId, "entry"),
    "/api/auction/entry",
    { cache: "no-store" },
  )) as EntryResponse;
}

const JSON_POST: RequestInit = {
  method: "POST",
  headers: { "Content-Type": "application/json" },
};

export async function startEntryCheckout(
  auctionId: string,
  runId: string,
) {
  return (await requestWithLegacyFallback(
    auctionId,
    dynamicRunPath(auctionId, runId, "entry"),
    "/api/auction/entry",
    { ...JSON_POST, body: JSON.stringify({}) },
  )) as EntryResponse;
}

export async function claimAuction(
  auctionId: string,
  runId: string,
  expectedPrice: number,
) {
  return (await requestWithLegacyFallback(
    auctionId,
    dynamicRunPath(auctionId, runId, "buy"),
    "/api/auction/buy",
    { ...JSON_POST, body: JSON.stringify({ expectedPrice }) },
  )) as BuyResponse;
}

export async function cancelPurchase(
  auctionId: string,
  runId: string,
) {
  return (await requestWithLegacyFallback(
    auctionId,
    dynamicRunPath(auctionId, runId, "purchase/cancel"),
    "/api/auction/purchase/cancel",
    { ...JSON_POST, body: JSON.stringify({}) },
  )) as CancelPurchaseResponse;
}
