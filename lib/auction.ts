export const AUCTION_ID = "demo-airpods-pro-1";
export const START_PRICE = 749;
export const FLOOR_PRICE = 699;
export const DEFAULT_REGULAR_PRICE = 999;
export const DEFAULT_PRODUCT_NAME = "AirPods Pro";
export const DEFAULT_DURATION_MINUTES = 10;
export const MIN_PRODUCT_PRICE = 2;
export const DROP_INTERVAL_MS = 12_000;
export const DEFAULT_AUCTION_RUN_ID = "run-2026-08-10-1010";
export const DEFAULT_AUCTION_STARTS_AT = new Date("2026-08-10T08:10:00.000Z");

export type AuctionDefinition = {
  productName: string;
  productImageUrl: string | null;
  regularPrice: number;
  startPrice: number;
  floorPrice: number;
  durationMinutes: number;
};

export type AuctionConfig = AuctionDefinition & {
  schemaVersion: 2;
  runId: string;
  startsAt: string;
};

export type TimedAuctionStatus = "waiting" | "live" | "ended";

export type TimedAuctionState = {
  currentPrice: number;
  status: TimedAuctionStatus;
};

export function defaultAuctionDefinition(): AuctionDefinition {
  return {
    productName: DEFAULT_PRODUCT_NAME,
    productImageUrl: null,
    regularPrice: DEFAULT_REGULAR_PRICE,
    startPrice: START_PRICE,
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
    regularPrice: config.regularPrice,
    startPrice: config.startPrice,
    floorPrice: config.floorPrice,
    durationMinutes: config.durationMinutes,
  };
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

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

export function parseAuctionDefinition(
  value: unknown,
): AuctionDefinition | null {
  if (!value || typeof value !== "object") return null;

  const candidate = value as Partial<AuctionDefinition>;
  const productName = candidate.productName?.trim();
  const productImageUrl = normalizedImageUrl(candidate.productImageUrl);
  const regularPrice = candidate.regularPrice;
  const startPrice = candidate.startPrice;
  const floorPrice = candidate.floorPrice;
  const durationMinutes = candidate.durationMinutes;

  if (
    !productName ||
    productName.length < 2 ||
    productName.length > 80 ||
    productImageUrl === undefined ||
    !isInteger(regularPrice) ||
    !isInteger(startPrice) ||
    !isInteger(floorPrice) ||
    !isInteger(durationMinutes) ||
    regularPrice < MIN_PRODUCT_PRICE ||
    regularPrice > 100_000 ||
    startPrice < MIN_PRODUCT_PRICE ||
    startPrice > regularPrice ||
    floorPrice < MIN_PRODUCT_PRICE ||
    floorPrice >= startPrice ||
    durationMinutes < 1 ||
    durationMinutes > 120
  ) {
    return null;
  }

  return {
    productName,
    productImageUrl,
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

  const totalDrops = config.startPrice - config.floorPrice;
  const totalPricePoints = totalDrops + 1;
  const elapsedMs = now - startMs;
  const floorWindowMs = Math.min(
    durationMs,
    Math.max(1_000, durationMs / totalPricePoints),
  );
  const fallingDurationMs = durationMs - floorWindowMs;

  if (elapsedMs >= fallingDurationMs) {
    return { status: "live", currentPrice: config.floorPrice };
  }

  const completedDrops = Math.floor(
    (elapsedMs * totalDrops) / fallingDurationMs,
  );

  return {
    status: "live",
    currentPrice: Math.max(
      config.floorPrice,
      config.startPrice - completedDrops,
    ),
  };
}
