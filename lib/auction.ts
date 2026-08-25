export const LEGACY_AUCTION_ID = "demo-airpods-pro-1";
export const AUCTION_ID = LEGACY_AUCTION_ID;
export const START_PRICE = 999;
export const FLOOR_PRICE = 1;
export const ENTRY_FEE = 5;
export const DEFAULT_REGULAR_PRICE = 999;
export const DEFAULT_PRODUCT_NAME = "AirPods Pro";
export const DEFAULT_AUCTION_CATEGORY = "electronics";
export const DEFAULT_DURATION_MINUTES = 10;
export const DEFAULT_POST_AUCTION_OFFER_VALIDITY_DAYS = 7;
export const MAX_POST_AUCTION_OFFER_VALIDITY_DAYS = 90;
export const MIN_PRODUCT_PRICE = 2;
export const DROP_INTERVAL_MS = 12_000;
export const DEFAULT_AUCTION_RUN_ID = "run-2026-08-10-1010";
export const DEFAULT_AUCTION_STARTS_AT = new Date("2026-08-10T08:10:00.000Z");

const AUCTION_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
const RUN_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,118}[A-Za-z0-9])?$/;

export type AuctionDefinition = {
  productName: string;
  productImageUrl: string | null;
  category: AuctionCategory;
  postAuctionOffer: PostAuctionOfferDefinition;
  entryFee: number;
  regularPrice: number;
  startPrice: number;
  floorPrice: number;
  durationMinutes: number;
};

export function auctionPublishIssues(definition: AuctionDefinition) {
  const issues: string[] = [];
  if (!definition.productImageUrl) issues.push("product_image_missing");
  if (definition.regularPrice !== definition.startPrice) issues.push("start_price_must_equal_regular_price");
  if (definition.floorPrice !== 1) issues.push("floor_price_must_equal_one");
  if (definition.entryFee < 1 || definition.entryFee >= definition.regularPrice) issues.push("entry_fee_invalid");
  if (definition.durationMinutes < 1 || definition.durationMinutes > 120) issues.push("duration_invalid");
  if (!definition.postAuctionOffer.enabled || definition.postAuctionOffer.validityDays < 1) issues.push("post_auction_offer_invalid");
  return issues;
}

export type PostAuctionOfferDefinition = {
  enabled: boolean;
  validityDays: number;
  inventory: number | null;
};

export const AUCTION_CATEGORIES = [
  "electronics",
  "home",
  "sport",
  "beauty",
  "gaming",
  "other",
] as const;

export type AuctionCategory = (typeof AUCTION_CATEGORIES)[number];

const AUCTION_CATEGORY_SET = new Set<string>(AUCTION_CATEGORIES);

export type AuctionConfig = AuctionDefinition & {
  schemaVersion: 2;
  runId: string;
  startsAt: string;
};

export type AuctionRecordState = "draft" | "published" | "archived";

export type AuctionRecord = AuctionDefinition & {
  schemaVersion: 1;
  auctionId: string;
  state: AuctionRecordState;
  currentRunId: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type TimedAuctionStatus = "waiting" | "live" | "ended";
export type PublicAuctionStatus =
  | TimedAuctionStatus
  | "payment_pending"
  | "sold";

export type TimedAuctionState = {
  currentPrice: number;
  status: TimedAuctionStatus;
};

type AuctionPriceSchedule = Pick<
  AuctionConfig,
  "startsAt" | "durationMinutes" | "startPrice" | "floorPrice" | "entryFee"
>;

export type PublicAuction = {
  auctionId: string;
  runId: string;
  product: string;
  productImageUrl: string | null;
  category: AuctionCategory;
  postAuctionOffer: PostAuctionOfferDefinition;
  regularPrice: number;
  startPrice: number;
  floorPrice: number;
  durationMinutes: number;
  currentPrice: number;
  entryFee: number;
  status: PublicAuctionStatus;
  startsAt: string;
  endsAt: string;
  soldAt: string | null;
  paymentExpiresAt: string | null;
  storageReady: boolean;
  serverTime: string;
};

export function normalizeAuctionId(value: unknown) {
  if (typeof value !== "string") return null;
  const auctionId = value.trim().toLowerCase();
  return AUCTION_ID_PATTERN.test(auctionId) ? auctionId : null;
}

export function normalizeRunId(value: unknown) {
  if (typeof value !== "string") return null;
  const runId = value.trim();
  return RUN_ID_PATTERN.test(runId) ? runId : null;
}

export function defaultAuctionDefinition(): AuctionDefinition {
  return {
    productName: DEFAULT_PRODUCT_NAME,
    productImageUrl: null,
    category: DEFAULT_AUCTION_CATEGORY,
    postAuctionOffer: {
      enabled: true,
      validityDays: DEFAULT_POST_AUCTION_OFFER_VALIDITY_DAYS,
      inventory: null,
    },
    entryFee: ENTRY_FEE,
    regularPrice: DEFAULT_REGULAR_PRICE,
    startPrice: DEFAULT_REGULAR_PRICE,
    floorPrice: FLOOR_PRICE,
    durationMinutes: DEFAULT_DURATION_MINUTES,
  };
}

export function auctionDefinitionFromConfig(
  config: AuctionConfig,
): AuctionDefinition {
  return {
    productName: config.productName,
    productImageUrl: config.productImageUrl,
    category: config.category,
    postAuctionOffer: config.postAuctionOffer,
    entryFee: config.entryFee,
    regularPrice: config.regularPrice,
    startPrice: config.startPrice,
    floorPrice: config.floorPrice,
    durationMinutes: config.durationMinutes,
  };
}

export function normalizePostAuctionOffer(
  value: unknown,
): PostAuctionOfferDefinition | null {
  if (value === undefined) {
    return {
      enabled: true,
      validityDays: DEFAULT_POST_AUCTION_OFFER_VALIDITY_DAYS,
      inventory: null,
    };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<PostAuctionOfferDefinition>;
  if (
    typeof candidate.validityDays !== "number" ||
    !Number.isInteger(candidate.validityDays) ||
    candidate.validityDays < 1 ||
    candidate.validityDays > MAX_POST_AUCTION_OFFER_VALIDITY_DAYS
  ) {
    return null;
  }
  return {
    enabled: true,
    validityDays: candidate.validityDays,
    inventory: null,
  };
}

export function inferAuctionCategory(productName: string): AuctionCategory {
  const name = productName.toLocaleLowerCase("pl-PL");
  if (/airpods|iphone|telefon|laptop|słuch|smart|tablet|elektr/.test(name)) {
    return "electronics";
  }
  if (/playstation|xbox|nintendo|konsol|gaming|gra /.test(name)) {
    return "gaming";
  }
  if (/dom|kuch|odkurz|ekspres|mebl|lampa/.test(name)) return "home";
  if (/rower|buty|sport|fitness|zegarek/.test(name)) return "sport";
  if (/kosmet|perfum|urod|włos/.test(name)) return "beauty";
  return "other";
}

export function normalizeAuctionCategory(
  value: unknown,
  productName: string,
): AuctionCategory | null {
  if (value === undefined) return inferAuctionCategory(productName);
  if (typeof value !== "string") return null;
  const category = value.trim().toLowerCase();
  return AUCTION_CATEGORY_SET.has(category)
    ? (category as AuctionCategory)
    : null;
}

function normalizedImageUrl(value: unknown) {
  if (value === null || value === "") return null;
  if (typeof value !== "string") return undefined;

  const imageUrl = value.trim();
  if (!imageUrl || imageUrl.length > 500 || imageUrl.includes("\\")) {
    return undefined;
  }

  if (imageUrl.startsWith("/") && !imageUrl.startsWith("//")) {
    return imageUrl;
  }

  try {
    const parsed = new URL(imageUrl);
    return parsed.protocol === "https:" &&
      !parsed.username &&
      !parsed.password &&
      !isPrivateImageHostname(parsed.hostname)
      ? parsed.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function isPrivateImageHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    normalized.includes(":")
  ) {
    return true;
  }

  const octets = normalized.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }

  const [first, second] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first >= 224
  );
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

export function parseAuctionDefinition(value: unknown): AuctionDefinition | null {
  if (!value || typeof value !== "object") return null;

  const candidate = value as Partial<AuctionDefinition>;
  const productName = candidate.productName?.trim();
  const productImageUrl = normalizedImageUrl(candidate.productImageUrl);
  const category = productName
    ? normalizeAuctionCategory(candidate.category, productName)
    : null;
  const postAuctionOffer = normalizePostAuctionOffer(candidate.postAuctionOffer);
  const regularPrice = candidate.regularPrice;
  const entryFee = candidate.entryFee ?? ENTRY_FEE;
  const durationMinutes = candidate.durationMinutes;

  if (
    !productName ||
    productName.length < 2 ||
    productName.length > 80 ||
    productImageUrl === undefined ||
    !category ||
    !postAuctionOffer ||
    !isInteger(entryFee) ||
    !isInteger(regularPrice) ||
    !isInteger(durationMinutes) ||
    entryFee < 1 ||
    entryFee >= regularPrice ||
    regularPrice < MIN_PRODUCT_PRICE ||
    regularPrice > 100_000 ||
    durationMinutes < 1 ||
    durationMinutes > 120
  ) {
    return null;
  }

  return {
    productName,
    productImageUrl,
    category,
    postAuctionOffer,
    entryFee,
    regularPrice,
    startPrice: regularPrice,
    floorPrice: FLOOR_PRICE,
    durationMinutes,
  };
}

function normalizeStoredPostAuctionOffer(
  value: unknown,
): PostAuctionOfferDefinition | null {
  if (value === undefined) {
    return {
      enabled: false,
      validityDays: DEFAULT_POST_AUCTION_OFFER_VALIDITY_DAYS,
      inventory: null,
    };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<PostAuctionOfferDefinition>;
  const inventory = candidate.inventory ?? null;
  if (
    typeof candidate.enabled !== "boolean" ||
    typeof candidate.validityDays !== "number" ||
    !Number.isInteger(candidate.validityDays) ||
    candidate.validityDays < 1 ||
    candidate.validityDays > MAX_POST_AUCTION_OFFER_VALIDITY_DAYS ||
    (inventory !== null &&
      (typeof inventory !== "number" ||
        !Number.isInteger(inventory) ||
        inventory < 1 ||
        inventory > 100_000))
  ) {
    return null;
  }
  return {
    enabled: candidate.enabled,
    validityDays: candidate.validityDays,
    inventory,
  };
}

// Immutable stored runs keep the rules they were created with. New and edited
// definitions use parseAuctionDefinition(), which applies the current rules.
export function parseStoredAuctionDefinition(
  value: unknown,
): AuctionDefinition | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<AuctionDefinition>;
  const productName = candidate.productName?.trim();
  const productImageUrl = normalizedImageUrl(candidate.productImageUrl);
  const category = productName
    ? normalizeAuctionCategory(candidate.category, productName)
    : null;
  const postAuctionOffer = normalizeStoredPostAuctionOffer(candidate.postAuctionOffer);
  const entryFee = candidate.entryFee ?? ENTRY_FEE;
  const regularPrice = candidate.regularPrice;
  const startPrice = candidate.startPrice;
  const floorPrice = candidate.floorPrice;
  const durationMinutes = candidate.durationMinutes;

  if (
    !productName ||
    productName.length < 2 ||
    productName.length > 80 ||
    productImageUrl === undefined ||
    !category ||
    !postAuctionOffer ||
    !isInteger(entryFee) ||
    !isInteger(regularPrice) ||
    !isInteger(startPrice) ||
    !isInteger(floorPrice) ||
    !isInteger(durationMinutes) ||
    entryFee < 1 ||
    regularPrice < MIN_PRODUCT_PRICE ||
    regularPrice > 100_000 ||
    startPrice < MIN_PRODUCT_PRICE ||
    startPrice > regularPrice ||
    floorPrice < 1 ||
    floorPrice >= startPrice ||
    durationMinutes < 1 ||
    durationMinutes > 120
  ) {
    return null;
  }

  return {
    productName,
    productImageUrl,
    category,
    postAuctionOffer,
    entryFee,
    regularPrice,
    startPrice,
    floorPrice,
    durationMinutes,
  };
}

export function defaultAuctionConfig(): AuctionConfig {
  return {
    schemaVersion: 2,
    runId: DEFAULT_AUCTION_RUN_ID,
    startsAt: DEFAULT_AUCTION_STARTS_AT.toISOString(),
    ...defaultAuctionDefinition(),
  };
}

export function legacyAuctionRecord(config: AuctionConfig): AuctionRecord {
  const createdAt = DEFAULT_AUCTION_STARTS_AT.toISOString();
  return {
    schemaVersion: 1,
    auctionId: LEGACY_AUCTION_ID,
    state: "published",
    currentRunId: config.runId,
    revision: 1,
    createdAt,
    updatedAt: config.startsAt,
    ...auctionDefinitionFromConfig(config),
  };
}

export function getAuctionDurationMs(
  config: Pick<AuctionConfig, "durationMinutes">,
) {
  return config.durationMinutes * 60_000;
}

export function getAuctionEndsAt(config: AuctionConfig) {
  return new Date(
    new Date(config.startsAt).getTime() + getAuctionDurationMs(config),
  );
}

export function isAuctionEntryWindowOpen(
  now: number,
  config: Pick<AuctionConfig, "startsAt">,
) {
  const startsAt = Date.parse(config.startsAt);
  return Number.isFinite(startsAt) && now < startsAt;
}

export function isAuctionPricePoint(
  price: number,
  config: Pick<AuctionConfig, "startPrice" | "floorPrice" | "entryFee">,
) {
  return (
    Number.isInteger(price) &&
    price >= config.floorPrice &&
    price <= config.startPrice &&
    (price === config.floorPrice ||
      (config.entryFee > 0 &&
        (config.startPrice - price) % config.entryFee === 0))
  );
}

export function getAuctionPriceAt(
  now: number,
  config: AuctionPriceSchedule,
) {
  const startMs = Date.parse(config.startsAt);
  const durationMs = config.durationMinutes * 60_000;
  const endMs = startMs + durationMs;

  if (!Number.isFinite(startMs) || durationMs <= 0) {
    return config.floorPrice;
  }
  if (now <= startMs) return config.startPrice;
  if (now >= endMs) return config.floorPrice;

  const priceStep = Math.max(1, Math.trunc(config.entryFee));
  const totalDropSteps = Math.ceil(
    (config.startPrice - config.floorPrice) / priceStep,
  );
  if (totalDropSteps <= 0) return config.floorPrice;

  const totalPricePoints = totalDropSteps + 1;
  const completedDropSteps = Math.min(
    totalDropSteps,
    Math.floor(((now - startMs) * totalPricePoints) / durationMs),
  );

  return Math.max(
    config.floorPrice,
    config.startPrice - completedDropSteps * priceStep,
  );
}

export function getTimedAuctionState(
  now: number = Date.now(),
  config: AuctionConfig = defaultAuctionConfig(),
): TimedAuctionState {
  const startMs = new Date(config.startsAt).getTime();
  const durationMs = getAuctionDurationMs(config);
  const endMs = startMs + durationMs;

  if (!Number.isFinite(startMs)) {
    return { status: "ended", currentPrice: config.floorPrice };
  }

  if (now < startMs) {
    return { status: "waiting", currentPrice: config.startPrice };
  }

  if (now >= endMs) {
    return { status: "ended", currentPrice: config.floorPrice };
  }

  return {
    status: "live",
    currentPrice: getAuctionPriceAt(now, config),
  };
}
