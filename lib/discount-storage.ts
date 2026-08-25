import { createHash, randomUUID } from "node:crypto";
import {
  getAuctionEndsAt,
  getTimedAuctionState,
  normalizeAuctionId,
  normalizeRunId,
  type AuctionConfig,
} from "./auction";
import type {
  AuctionWinner,
  ParticipantRunRecord,
} from "./auction-storage";
import {
  normalizeOrderId,
  orderKey,
  orderReferenceKey,
  ordersIndexKey,
  type AuctionOrder,
} from "./order-storage";
import {
  normalizePaymentProvider,
  type PaymentProviderName,
} from "./payment-types";
import { redisCommand } from "./redis";

const ACCOUNT_ID_PATTERN = /^[A-Za-z0-9_-]{3,100}$/;
const DISCOUNT_ID_PATTERN = /^RABAT-[A-F0-9]{40}$/;
const RESERVATION_MS = 31 * 60_000;

export type PostAuctionDiscountState =
  | "available"
  | "reserved"
  | "redeemed"
  | "expired"
  | "revoked";

export type PostAuctionDiscount = {
  schemaVersion: 1;
  discountId: string;
  accountId: string;
  participantId: string;
  auctionId: string;
  runId: string;
  product: string;
  productImageUrl: string | null;
  regularPrice: number;
  discountAmount: number;
  finalPrice: number;
  currency: "pln";
  issuedAt: string;
  expiresAt: string;
  state: PostAuctionDiscountState;
  inventory: number | null;
  reservationToken?: string;
  reservedAt?: string;
  reservationExpiresAt?: string;
  paymentProvider?: PaymentProviderName;
  paymentReference?: string;
  paymentCheckoutUrl?: string;
  redeemedAt?: string;
  orderId?: string;
};

function environmentName() {
  return process.env.VERCEL_ENV ?? "local";
}

function prefix() {
  return `fiszy:${environmentName()}`;
}

function checkedAccountId(value: string) {
  const accountId = value.trim();
  if (!ACCOUNT_ID_PATTERN.test(accountId)) throw new Error("Invalid account id.");
  return accountId;
}

function checkedParticipantId(value: string) {
  const participantId = value.trim();
  if (!participantId || participantId.length > 100) {
    throw new Error("Invalid participant id.");
  }
  return participantId;
}

function checkedDiscountId(value: string) {
  const discountId = value.trim().toUpperCase();
  if (!DISCOUNT_ID_PATTERN.test(discountId)) {
    throw new Error("Invalid discount id.");
  }
  return discountId;
}

function discountKey(discountId: string) {
  return `${prefix()}:discount:${checkedDiscountId(discountId)}`;
}

function accountDiscountIndexKey(accountId: string) {
  return `${prefix()}:account:${encodeURIComponent(checkedAccountId(accountId))}:index:v1:discounts`;
}

function discountIndexKey() {
  return `${prefix()}:index:v1:discounts`;
}

function runReservationsKey(auctionId: string, runId: string) {
  const auction = normalizeAuctionId(auctionId);
  const run = normalizeRunId(runId);
  if (!auction || !run) throw new Error("Invalid auction run.");
  return `${prefix()}:auction:${auction}:run:${run}:discounts:v1:reserved`;
}

function runRedeemedKey(auctionId: string, runId: string) {
  const auction = normalizeAuctionId(auctionId);
  const run = normalizeRunId(runId);
  if (!auction || !run) throw new Error("Invalid auction run.");
  return `${prefix()}:auction:${auction}:run:${run}:discounts:v1:redeemed`;
}

function validDate(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validMoney(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function normalizeDiscountId(value: unknown) {
  if (typeof value !== "string") return null;
  const discountId = value.trim().toUpperCase();
  return DISCOUNT_ID_PATTERN.test(discountId) ? discountId : null;
}

export function normalizeStoredPostAuctionDiscount(
  value: unknown,
): PostAuctionDiscount | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<PostAuctionDiscount>;
  const discountId = normalizeDiscountId(candidate.discountId);
  const auctionId = normalizeAuctionId(candidate.auctionId);
  const runId = normalizeRunId(candidate.runId);
  const productImageUrl = candidate.productImageUrl ?? null;
  const inventory = candidate.inventory ?? null;
  const provider = candidate.paymentProvider === undefined
    ? undefined
    : normalizePaymentProvider(candidate.paymentProvider);
  const states: PostAuctionDiscountState[] = [
    "available",
    "reserved",
    "redeemed",
    "expired",
    "revoked",
  ];
  if (
    candidate.schemaVersion !== 1 ||
    !discountId ||
    typeof candidate.accountId !== "string" ||
    !ACCOUNT_ID_PATTERN.test(candidate.accountId) ||
    typeof candidate.participantId !== "string" ||
    !candidate.participantId ||
    candidate.participantId.length > 100 ||
    !auctionId ||
    !runId ||
    typeof candidate.product !== "string" ||
    !candidate.product ||
    candidate.product.length > 80 ||
    (productImageUrl !== null && typeof productImageUrl !== "string") ||
    !validMoney(candidate.regularPrice) ||
    !validMoney(candidate.discountAmount) ||
    !validMoney(candidate.finalPrice) ||
    candidate.finalPrice !== candidate.regularPrice - candidate.discountAmount ||
    candidate.finalPrice < 1 ||
    candidate.currency !== "pln" ||
    !validDate(candidate.issuedAt) ||
    !validDate(candidate.expiresAt) ||
    !states.includes(candidate.state as PostAuctionDiscountState) ||
    (inventory !== null &&
      (!Number.isInteger(inventory) || Number(inventory) < 1)) ||
    (candidate.paymentProvider !== undefined && !provider) ||
    (candidate.paymentReference !== undefined &&
      (typeof candidate.paymentReference !== "string" ||
        !candidate.paymentReference ||
        candidate.paymentReference.length > 200)) ||
    (candidate.reservationToken !== undefined &&
      (typeof candidate.reservationToken !== "string" ||
        candidate.reservationToken.length > 100)) ||
    (candidate.reservedAt !== undefined && !validDate(candidate.reservedAt)) ||
    (candidate.reservationExpiresAt !== undefined &&
      !validDate(candidate.reservationExpiresAt)) ||
    (candidate.redeemedAt !== undefined && !validDate(candidate.redeemedAt)) ||
    (candidate.orderId !== undefined && !normalizeOrderId(candidate.orderId))
  ) {
    return null;
  }
  return {
    ...(candidate as PostAuctionDiscount),
    discountId,
    auctionId,
    runId,
    productImageUrl,
    inventory,
    ...(provider ? { paymentProvider: provider } : {}),
  };
}

function parseStoredDiscount(raw: unknown) {
  if (typeof raw !== "string" || !raw) return null;
  try {
    return normalizeStoredPostAuctionDiscount(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function postAuctionDiscountId(input: {
  auctionId: string;
  runId: string;
  participantId: string;
}) {
  const digest = createHash("sha256")
    .update(`${input.auctionId}\u0000${input.runId}\u0000${input.participantId}`)
    .digest("hex")
    .slice(0, 40)
    .toUpperCase();
  return `RABAT-${digest}`;
}

export function preparePostAuctionDiscount(input: {
  accountId: string;
  participant: ParticipantRunRecord;
  config: AuctionConfig;
  winner: AuctionWinner | null;
  order?: AuctionOrder | null;
  now?: number;
}): PostAuctionDiscount | null {
  const now = input.now ?? Date.now();
  const { participant, config, winner, order = null } = input;
  const accountId = checkedAccountId(input.accountId);
  const participantId = checkedParticipantId(participant.participantId);
  if (
    participantId !== `clerk:${accountId}` ||
    participant.entryStatus !== "granted" ||
    participant.runId !== config.runId ||
    !config.postAuctionOffer.enabled ||
    winner?.bidderId === participantId
  ) {
    return null;
  }
  const timedState = getTimedAuctionState(now, config);
  const settledWinner = winner && order &&
    order.auctionId === participant.auctionId &&
    order.runId === participant.runId &&
    order.bidderId === winner.bidderId;
  if (winner && !settledWinner) return null;
  if (!winner && timedState.status !== "ended") return null;
  const regularPrice = config.regularPrice;
  const discountAmount = participant.entryFee;
  const finalPrice = regularPrice - discountAmount;
  if (
    !Number.isInteger(discountAmount) ||
    discountAmount < 1 ||
    !Number.isInteger(regularPrice) ||
    finalPrice < 1
  ) {
    return null;
  }
  const terminalAt = settledWinner
    ? Date.parse(order.paidAt)
    : getAuctionEndsAt(config).getTime();
  if (!Number.isFinite(terminalAt) || now < terminalAt) return null;
  const expiresAt = terminalAt + config.postAuctionOffer.validityDays * 86_400_000;
  return {
    schemaVersion: 1,
    discountId: postAuctionDiscountId({
      auctionId: participant.auctionId,
      runId: participant.runId,
      participantId,
    }),
    accountId,
    participantId,
    auctionId: participant.auctionId,
    runId: participant.runId,
    product: config.productName,
    productImageUrl: config.productImageUrl,
    regularPrice,
    discountAmount,
    finalPrice,
    currency: "pln",
    issuedAt: new Date(terminalAt).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
    state: now >= expiresAt ? "expired" : "available",
    inventory: config.postAuctionOffer.inventory,
  };
}

export async function issuePostAuctionDiscount(
  discount: PostAuctionDiscount,
): Promise<PostAuctionDiscount> {
  const normalized = normalizeStoredPostAuctionDiscount(discount);
  if (!normalized) throw new Error("Invalid post-auction discount.");
  const issuedAt = Date.parse(normalized.issuedAt);
  const raw = await redisCommand<string>([
    "EVAL",
    `
local created = redis.call("SET", KEYS[1], ARGV[1], "NX")
local canonical = redis.call("GET", KEYS[1])
if not canonical then return false end
redis.call("ZADD", KEYS[2], ARGV[2], ARGV[3])
redis.call("ZADD", KEYS[3], ARGV[2], ARGV[3])
return canonical
`,
    3,
    discountKey(normalized.discountId),
    accountDiscountIndexKey(normalized.accountId),
    discountIndexKey(),
    JSON.stringify(normalized),
    issuedAt,
    normalized.discountId,
  ]);
  const stored = parseStoredDiscount(raw);
  if (!stored || stored.accountId !== normalized.accountId) {
    throw new Error("Stored post-auction discount is invalid.");
  }
  return stored;
}

export async function readPostAuctionDiscount(discountIdValue: string) {
  const discountId = normalizeDiscountId(discountIdValue);
  if (!discountId) return null;
  const raw = await redisCommand<string>(["GET", discountKey(discountId)]);
  return parseStoredDiscount(raw);
}

type ReservationResult =
  | { outcome: "reserved" | "existing"; discount: PostAuctionDiscount }
  | { outcome: "unavailable" | "expired" | "sold_out" };

export async function reservePostAuctionDiscount(input: {
  discountId: string;
  accountId: string;
  now?: number;
}): Promise<ReservationResult> {
  const discountId = checkedDiscountId(input.discountId);
  const accountId = checkedAccountId(input.accountId);
  const now = input.now ?? Date.now();
  const stored = await readPostAuctionDiscount(discountId);
  if (!stored || stored.accountId !== accountId) {
    return { outcome: "unavailable" };
  }
  const reservationToken = randomUUID();
  const reservationExpiresAt = now + RESERVATION_MS;
  const result = await redisCommand<Array<number | string>>([
    "EVAL",
    `
local raw = redis.call("GET", KEYS[1])
if not raw then return {-1} end
local ok, discount = pcall(cjson.decode, raw)
if not ok or type(discount) ~= "table" or discount.accountId ~= ARGV[1] then return {-1} end
if discount.state == "redeemed" or discount.state == "revoked" then return {-1} end
local expiresAt = tonumber(ARGV[2])
if not expiresAt or expiresAt <= tonumber(ARGV[3]) then return {-2} end
redis.call("ZREMRANGEBYSCORE", KEYS[2], "-inf", ARGV[3])
if discount.state == "reserved" then
  local reservationExpiry = tonumber(discount.reservationExpiresAtMs or 0)
  if reservationExpiry > tonumber(ARGV[3]) then return {2, raw} end
  redis.call("ZREM", KEYS[2], discount.discountId)
end
local inventory = discount.inventory
if type(inventory) == "number" then
  local used = redis.call("ZCARD", KEYS[2]) + redis.call("ZCARD", KEYS[3])
  if used >= tonumber(inventory) then return {-3} end
end
discount.state = "reserved"
discount.reservationToken = ARGV[4]
discount.reservedAt = ARGV[5]
discount.reservationExpiresAt = ARGV[6]
discount.reservationExpiresAtMs = tonumber(ARGV[7])
discount.paymentProvider = nil
discount.paymentReference = nil
discount.paymentCheckoutUrl = nil
local updated = cjson.encode(discount)
redis.call("SET", KEYS[1], updated)
redis.call("ZADD", KEYS[2], ARGV[7], discount.discountId)
return {1, updated}
`,
    3,
    discountKey(discountId),
    runReservationsKey(stored.auctionId, stored.runId),
    runRedeemedKey(stored.auctionId, stored.runId),
    accountId,
    Date.parse(stored.expiresAt),
    now,
    reservationToken,
    new Date(now).toISOString(),
    new Date(reservationExpiresAt).toISOString(),
    reservationExpiresAt,
  ]);
  const code = Number(result?.[0]);
  if (code === -2) return { outcome: "expired" };
  if (code === -3) return { outcome: "sold_out" };
  if (code < 0 || !result?.[1]) return { outcome: "unavailable" };
  const discount = parseStoredDiscount(result[1]);
  if (!discount) throw new Error("Reserved discount is invalid.");
  return { outcome: code === 2 ? "existing" : "reserved", discount };
}

export async function attachDiscountPaymentSession(input: {
  discountId: string;
  accountId: string;
  reservationToken: string;
  provider: PaymentProviderName;
  reference: string;
  checkoutUrl: string;
}) {
  const result = await redisCommand<number>([
    "EVAL",
    `
local raw = redis.call("GET", KEYS[1])
if not raw then return 0 end
local ok, discount = pcall(cjson.decode, raw)
if not ok or type(discount) ~= "table" then return 0 end
if discount.accountId ~= ARGV[1] or discount.state ~= "reserved" or discount.reservationToken ~= ARGV[2] then return 0 end
if discount.paymentReference and discount.paymentReference ~= ARGV[4] then return -1 end
discount.paymentProvider = ARGV[3]
discount.paymentReference = ARGV[4]
discount.paymentCheckoutUrl = ARGV[5]
redis.call("SET", KEYS[1], cjson.encode(discount))
return 1
`,
    1,
    discountKey(input.discountId),
    checkedAccountId(input.accountId),
    input.reservationToken,
    input.provider,
    input.reference,
    input.checkoutUrl,
  ]);
  return result ?? 0;
}

export async function releasePostAuctionDiscount(input: {
  discountId: string;
  accountId: string;
  reservationToken: string;
  paymentReference?: string;
}) {
  const discount = await readPostAuctionDiscount(input.discountId);
  if (!discount) return 0;
  return (await redisCommand<number>([
    "EVAL",
    `
local raw = redis.call("GET", KEYS[1])
if not raw then return 0 end
local ok, discount = pcall(cjson.decode, raw)
if not ok or type(discount) ~= "table" then return 0 end
if discount.accountId ~= ARGV[1] or discount.state ~= "reserved" or discount.reservationToken ~= ARGV[2] then return 0 end
if ARGV[3] ~= "" and discount.paymentReference ~= ARGV[3] then return 0 end
redis.call("ZREM", KEYS[2], discount.discountId)
discount.state = "available"
discount.reservationToken = nil
discount.reservedAt = nil
discount.reservationExpiresAt = nil
discount.reservationExpiresAtMs = nil
discount.paymentProvider = nil
discount.paymentReference = nil
discount.paymentCheckoutUrl = nil
redis.call("SET", KEYS[1], cjson.encode(discount))
return 1
`,
    2,
    discountKey(discount.discountId),
    runReservationsKey(discount.auctionId, discount.runId),
    checkedAccountId(input.accountId),
    input.reservationToken,
    input.paymentReference ?? "",
  ])) ?? 0;
}

export function discountOrderRunId(discountId: string) {
  return `offer-${createHash("sha256").update(checkedDiscountId(discountId)).digest("hex").slice(0, 32)}`;
}

export function discountOrderId(discountId: string, paymentReference: string) {
  return `FISZY-RABAT-${createHash("sha256")
    .update(`${checkedDiscountId(discountId)}\u0000${paymentReference}`)
    .digest("hex")
    .toUpperCase()}`;
}

export async function redeemPostAuctionDiscount(input: {
  discountId: string;
  accountId: string;
  reservationToken: string;
  provider: PaymentProviderName;
  reference: string;
  order: AuctionOrder;
}) {
  const discount = await readPostAuctionDiscount(input.discountId);
  if (!discount) return -2;
  const runId = discountOrderRunId(discount.discountId);
  if (
    input.order.auctionId !== discount.auctionId ||
    input.order.runId !== runId ||
    input.order.bidderId !== discount.participantId ||
    input.order.amount !== discount.finalPrice ||
    input.order.paymentReference !== input.reference ||
    input.order.orderKind !== "post_auction_discount" ||
    input.order.discountId !== discount.discountId
  ) {
    throw new Error("Discount order does not match its offer.");
  }
  const reference = `${discount.auctionId}|${runId}`;
  const paidAtMs = Date.parse(input.order.paidAt);
  if (!Number.isFinite(paidAtMs)) throw new Error("Invalid discount order paidAt.");
  return (await redisCommand<number>([
    "EVAL",
    `
local raw = redis.call("GET", KEYS[1])
if not raw then return -2 end
local ok, discount = pcall(cjson.decode, raw)
if not ok or type(discount) ~= "table" then return -2 end
if discount.accountId ~= ARGV[1] or discount.reservationToken ~= ARGV[2] then return -2 end
if discount.paymentProvider ~= ARGV[3] or discount.paymentReference ~= ARGV[4] then return -2 end
if discount.state == "redeemed" and discount.orderId == ARGV[8] then return 0 end
if discount.state ~= "reserved" then return -2 end
local existingRef = redis.call("GET", KEYS[6])
if existingRef and existingRef ~= ARGV[7] then return -3 end
local existingOrder = redis.call("GET", KEYS[4])
if existingOrder and existingOrder ~= ARGV[5] then return -4 end
redis.call("SET", KEYS[4], ARGV[5], "NX")
redis.call("ZADD", KEYS[5], ARGV[6], ARGV[7])
redis.call("SET", KEYS[6], ARGV[7], "NX")
redis.call("ZREM", KEYS[2], discount.discountId)
redis.call("ZADD", KEYS[3], ARGV[6], discount.discountId)
discount.state = "redeemed"
discount.redeemedAt = ARGV[9]
discount.orderId = ARGV[8]
discount.paymentCheckoutUrl = nil
redis.call("SET", KEYS[1], cjson.encode(discount))
return 1
`,
    6,
    discountKey(discount.discountId),
    runReservationsKey(discount.auctionId, discount.runId),
    runRedeemedKey(discount.auctionId, discount.runId),
    orderKey(runId, discount.auctionId),
    ordersIndexKey(),
    orderReferenceKey(input.order.orderId),
    checkedAccountId(input.accountId),
    input.reservationToken,
    input.provider,
    input.reference,
    JSON.stringify(input.order),
    paidAtMs,
    reference,
    input.order.orderId,
    input.order.paidAt,
  ])) ?? -2;
}
