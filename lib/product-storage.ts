import { randomUUID } from "node:crypto";
import {
  AUCTION_CATEGORIES,
  DEFAULT_POST_AUCTION_OFFER_VALIDITY_DAYS,
  FLOOR_PRICE,
  type AuctionCategory,
  normalizeAuctionId,
} from "./auction";
import { redisCommand } from "./redis";
import { listSortedSetPage } from "./sorted-set-pagination";

export const PRODUCT_STATUSES = ["draft", "active", "archived"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export type ProductInventory = {
  mode: "unlimited" | "tracked";
  available: number;
  reserved: number;
};

export type ProductAuctionTemplate = {
  entryFee: number;
  regularPrice: number;
  durationMinutes: number;
  postAuctionOfferValidityDays: number;
};

export type ProductRecord = {
  schemaVersion: 1;
  productId: string;
  sku: string;
  name: string;
  description: string;
  imageUrls: string[];
  category: AuctionCategory;
  status: ProductStatus;
  inventory: ProductInventory;
  auctionTemplate: ProductAuctionTemplate;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type ProductInput = Omit<
  ProductRecord,
  "schemaVersion" | "productId" | "revision" | "createdAt" | "updatedAt"
>;

const PRODUCT_ID_PATTERN = /^PRD-[A-F0-9]{24}$/;
const SKU_PATTERN = /^[A-Z0-9](?:[A-Z0-9._-]{0,62}[A-Z0-9])?$/;
const CATEGORY_SET = new Set<string>(AUCTION_CATEGORIES);
const STATUS_SET = new Set<string>(PRODUCT_STATUSES);

function environmentName() {
  return process.env.VERCEL_ENV ?? "local";
}

function prefix() {
  return `fiszy:${environmentName()}`;
}

function productKey(productId: string) {
  if (!PRODUCT_ID_PATTERN.test(productId)) throw new Error("Invalid product id.");
  return `${prefix()}:product:${productId}`;
}

function productIndexKey() {
  return `${prefix()}:index:v1:products`;
}

function productSkuKey(sku: string) {
  if (!SKU_PATTERN.test(sku)) throw new Error("Invalid product SKU.");
  return `${prefix()}:product-sku:${encodeURIComponent(sku)}`;
}

function auctionProductKey(auctionIdValue: string) {
  const auctionId = normalizeAuctionId(auctionIdValue);
  if (!auctionId) throw new Error("Invalid auction id.");
  return `${prefix()}:auction:${auctionId}:product-ref`;
}

function inventoryOrderMarkerKey(orderId: string) {
  if (!orderId || orderId.length > 200 || /[\u0000-\u001f\u007f]/.test(orderId)) throw new Error("Invalid order id.");
  return `${prefix()}:inventory:v1:order:${encodeURIComponent(orderId)}`;
}

function cleanText(value: unknown, maxLength: number, allowEmpty = false) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/g, " ");
  if (
    (!allowEmpty && !normalized) ||
    normalized.length > maxLength ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function normalizedImageUrl(value: unknown) {
  if (typeof value !== "string") return null;
  const url = value.trim();
  if (!url || url.length > 500 || url.includes("\\")) return null;
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

function normalizeInventory(value: unknown): ProductInventory | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<ProductInventory>;
  if (candidate.mode === "unlimited") {
    return { mode: "unlimited", available: 0, reserved: 0 };
  }
  if (
    candidate.mode !== "tracked" ||
    !Number.isInteger(candidate.available) ||
    !Number.isInteger(candidate.reserved) ||
    Number(candidate.available) < 0 ||
    Number(candidate.available) > 100_000 ||
    Number(candidate.reserved) < 0 ||
    Number(candidate.reserved) > Number(candidate.available)
  ) {
    return null;
  }
  return {
    mode: "tracked",
    available: Number(candidate.available),
    reserved: Number(candidate.reserved),
  };
}

function normalizeAuctionTemplate(value: unknown): ProductAuctionTemplate | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<ProductAuctionTemplate>;
  if (
    !Number.isInteger(candidate.entryFee) ||
    !Number.isInteger(candidate.regularPrice) ||
    !Number.isInteger(candidate.durationMinutes) ||
    !Number.isInteger(candidate.postAuctionOfferValidityDays) ||
    Number(candidate.entryFee) < 1 ||
    Number(candidate.regularPrice) < 2 ||
    Number(candidate.regularPrice) > 100_000 ||
    Number(candidate.entryFee) >= Number(candidate.regularPrice) ||
    Number(candidate.durationMinutes) < 1 ||
    Number(candidate.durationMinutes) > 120 ||
    Number(candidate.postAuctionOfferValidityDays) < 1 ||
    Number(candidate.postAuctionOfferValidityDays) > 90
  ) {
    return null;
  }
  return {
    entryFee: Number(candidate.entryFee),
    regularPrice: Number(candidate.regularPrice),
    durationMinutes: Number(candidate.durationMinutes),
    postAuctionOfferValidityDays: Number(candidate.postAuctionOfferValidityDays),
  };
}

export function normalizeProductId(value: unknown) {
  return typeof value === "string" && PRODUCT_ID_PATTERN.test(value.trim())
    ? value.trim()
    : null;
}

export function normalizeProductInput(value: unknown): ProductInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<ProductInput>;
  const sku = cleanText(candidate.sku, 64)?.toUpperCase() ?? null;
  const name = cleanText(candidate.name, 120);
  const description = cleanText(candidate.description ?? "", 3000, true);
  const imageUrls = Array.isArray(candidate.imageUrls)
    ? candidate.imageUrls.map(normalizedImageUrl)
    : null;
  const inventory = normalizeInventory(candidate.inventory);
  const auctionTemplate = normalizeAuctionTemplate(candidate.auctionTemplate);
  if (
    !sku ||
    !SKU_PATTERN.test(sku) ||
    !name ||
    description === null ||
    !imageUrls ||
    imageUrls.length > 6 ||
    imageUrls.some((url) => !url) ||
    !CATEGORY_SET.has(String(candidate.category)) ||
    !STATUS_SET.has(String(candidate.status)) ||
    !inventory ||
    !auctionTemplate
  ) {
    return null;
  }
  return {
    sku,
    name,
    description,
    imageUrls: imageUrls as string[],
    category: candidate.category as AuctionCategory,
    status: candidate.status as ProductStatus,
    inventory,
    auctionTemplate,
  };
}

export function defaultProductInput(): ProductInput {
  return {
    sku: "NOWY-PRODUKT",
    name: "Nowy produkt",
    description: "",
    imageUrls: [],
    category: "other",
    status: "draft",
    inventory: { mode: "unlimited", available: 0, reserved: 0 },
    auctionTemplate: {
      entryFee: 5,
      regularPrice: 100,
      durationMinutes: 10,
      postAuctionOfferValidityDays: DEFAULT_POST_AUCTION_OFFER_VALIDITY_DAYS,
    },
  };
}

export function parseStoredProduct(raw: unknown): ProductRecord | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const candidate = JSON.parse(raw) as Partial<ProductRecord>;
    const input = normalizeProductInput(candidate);
    const productId = normalizeProductId(candidate.productId);
    if (
      candidate.schemaVersion !== 1 ||
      !productId ||
      !input ||
      !Number.isInteger(candidate.revision) ||
      Number(candidate.revision) < 1 ||
      typeof candidate.createdAt !== "string" ||
      typeof candidate.updatedAt !== "string" ||
      !Number.isFinite(Date.parse(candidate.createdAt)) ||
      !Number.isFinite(Date.parse(candidate.updatedAt))
    ) {
      return null;
    }
    return {
      schemaVersion: 1,
      productId,
      ...input,
      revision: Number(candidate.revision),
      createdAt: candidate.createdAt,
      updatedAt: candidate.updatedAt,
    };
  } catch {
    return null;
  }
}

export function productAuctionDefinition(product: ProductRecord) {
  return {
    productName: product.name,
    productImageUrl: product.imageUrls[0] ?? null,
    category: product.category,
    postAuctionOffer: {
      enabled: true,
      validityDays: product.auctionTemplate.postAuctionOfferValidityDays,
      inventory: null,
    },
    entryFee: product.auctionTemplate.entryFee,
    regularPrice: product.auctionTemplate.regularPrice,
    startPrice: product.auctionTemplate.regularPrice,
    floorPrice: FLOOR_PRICE,
    durationMinutes: product.auctionTemplate.durationMinutes,
  } as const;
}

export async function createProduct(input: ProductInput) {
  const normalized = normalizeProductInput(input);
  if (!normalized) throw new Error("Invalid product input.");
  const now = new Date().toISOString();
  const product: ProductRecord = {
    schemaVersion: 1,
    productId: `PRD-${randomUUID().replaceAll("-", "").slice(0, 24).toUpperCase()}`,
    ...normalized,
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
  const result = await redisCommand<number>([
    "EVAL",
    `
if redis.call("EXISTS", KEYS[1]) == 1 or redis.call("EXISTS", KEYS[2]) == 1 then return 0 end
redis.call("SET", KEYS[1], ARGV[1])
redis.call("SET", KEYS[2], ARGV[2])
redis.call("ZADD", KEYS[3], ARGV[3], ARGV[2])
return 1
`,
    3,
    productKey(product.productId),
    productSkuKey(product.sku),
    productIndexKey(),
    JSON.stringify(product),
    product.productId,
    Date.parse(product.updatedAt),
  ]);
  if (result !== 1) return null;
  return product;
}

export async function readProduct(productIdValue: string) {
  const productId = normalizeProductId(productIdValue);
  if (!productId) return null;
  const product = parseStoredProduct(await redisCommand<string>(["GET", productKey(productId)]));
  return product?.productId === productId ? product : null;
}

export async function listProducts(input: { cursor?: string | null; limit?: number }) {
  const page = await listSortedSetPage({
    indexKey: productIndexKey(),
    purpose: "products.v1",
    cursor: input.cursor,
    limit: input.limit ?? 30,
  });
  if (!page) return null;
  const raw = page.members.length
    ? ((await redisCommand<Array<string | null>>(["MGET", ...page.members.map(productKey)])) ?? [])
    : [];
  const products = raw.flatMap((value, index) => {
    const product = parseStoredProduct(value);
    return product?.productId === page.members[index] ? [product] : [];
  });
  return { products, nextCursor: page.nextCursor };
}

export async function updateProduct(input: {
  productId: string;
  expectedRevision: number;
  product: ProductInput;
}) {
  const productId = normalizeProductId(input.productId);
  const normalized = normalizeProductInput(input.product);
  if (!productId || !normalized || !Number.isInteger(input.expectedRevision)) return null;
  const current = await readProduct(productId);
  if (!current || current.revision !== input.expectedRevision) return null;
  const next: ProductRecord = {
    ...current,
    ...normalized,
    revision: current.revision + 1,
    updatedAt: new Date().toISOString(),
  };
  const result = await redisCommand<number>([
    "EVAL",
    `
local raw = redis.call("GET", KEYS[1])
if not raw then return 0 end
local ok, stored = pcall(cjson.decode, raw)
if not ok or type(stored) ~= "table" or stored.revision ~= tonumber(ARGV[1]) then return 0 end
if ARGV[2] ~= ARGV[3] and redis.call("EXISTS", KEYS[3]) == 1 then return -1 end
redis.call("SET", KEYS[1], ARGV[4])
if ARGV[2] ~= ARGV[3] then
  redis.call("DEL", KEYS[2])
  redis.call("SET", KEYS[3], ARGV[5])
end
redis.call("ZADD", KEYS[4], ARGV[6], ARGV[5])
return 1
`,
    4,
    productKey(productId),
    productSkuKey(current.sku),
    productSkuKey(next.sku),
    productIndexKey(),
    input.expectedRevision,
    current.sku,
    next.sku,
    JSON.stringify(next),
    productId,
    Date.parse(next.updatedAt),
  ]);
  return result === 1 ? next : null;
}

export async function adjustProductInventory(input: {
  productId: string;
  expectedRevision: number;
  deltaAvailable: number;
  deltaReserved: number;
}) {
  const productId = normalizeProductId(input.productId);
  if (
    !productId ||
    !Number.isInteger(input.expectedRevision) ||
    !Number.isInteger(input.deltaAvailable) ||
    !Number.isInteger(input.deltaReserved)
  ) return null;
  const current = await readProduct(productId);
  if (!current || current.revision !== input.expectedRevision) return null;
  if (current.inventory.mode === "unlimited") return current;
  const available = current.inventory.available + input.deltaAvailable;
  const reserved = current.inventory.reserved + input.deltaReserved;
  if (available < 0 || reserved < 0 || reserved > available || available > 100_000) return null;
  return updateProduct({
    productId,
    expectedRevision: current.revision,
    product: { ...current, inventory: { mode: "tracked", available, reserved } },
  });
}

export async function linkProductAuction(productIdValue: string, auctionIdValue: string) {
  const productId = normalizeProductId(productIdValue);
  const auctionId = normalizeAuctionId(auctionIdValue);
  if (!productId || !auctionId) return false;
  const product = await readProduct(productId);
  if (!product || product.status === "archived") return false;
  const result = await redisCommand<string>(["SET", auctionProductKey(auctionId), productId, "NX"]);
  if (result === "OK") return true;
  return (await redisCommand<string>(["GET", auctionProductKey(auctionId)])) === productId;
}

export async function readAuctionProductId(auctionIdValue: string) {
  const auctionId = normalizeAuctionId(auctionIdValue);
  if (!auctionId) return null;
  const productId = await redisCommand<string>(["GET", auctionProductKey(auctionId)]);
  return normalizeProductId(productId);
}

export async function consumeProductInventoryForOrder(input: { auctionId: string; orderId: string }) {
  const productId = await readAuctionProductId(input.auctionId);
  if (!productId) return { outcome: "unlinked" as const, productId: null };
  const product = await readProduct(productId);
  if (!product) throw new Error("Linked product record is missing.");
  const next: ProductRecord = product.inventory.mode === "tracked"
    ? {
        ...product,
        inventory: { ...product.inventory, available: product.inventory.available - 1 },
        revision: product.revision + 1,
        updatedAt: new Date().toISOString(),
      }
    : product;
  if (product.inventory.mode === "tracked" && product.inventory.available < 1) {
    return { outcome: "out_of_stock" as const, productId };
  }
  const result = await redisCommand<number>(["EVAL", `
if redis.call("EXISTS", KEYS[2]) == 1 then return 0 end
local raw = redis.call("GET", KEYS[1])
if not raw then return -2 end
local ok, current = pcall(cjson.decode, raw)
if not ok or type(current) ~= "table" or current.revision ~= tonumber(ARGV[1]) then return -3 end
if current.inventory.mode == "tracked" then redis.call("SET", KEYS[1], ARGV[2]); redis.call("ZADD", KEYS[3], ARGV[3], ARGV[4]) end
redis.call("SET", KEYS[2], ARGV[4])
return 1`, 3, productKey(productId), inventoryOrderMarkerKey(input.orderId), productIndexKey(), product.revision, JSON.stringify(next), Date.parse(next.updatedAt), productId]);
  if (result === -3) throw new Error("Product inventory changed concurrently.");
  if (result === -2) throw new Error("Linked product record disappeared.");
  return { outcome: result === 0 ? "already_consumed" as const : "consumed" as const, productId };
}
