import { createHash, randomUUID } from "node:crypto";
import { redisCommand } from "./redis";
import type { StripeCheckoutSession } from "./stripe";

export type AutopayIntent = {
  orderId: string; reference: string; kind: "auction_entry" | "auction_purchase" | "post_auction_purchase";
  auctionId: string; runId: string; bidderId: string; amount: number;
  claimToken?: string; discountId?: string; accountId?: string; reservationToken?: string;
  entryConsentId?: string;
  createdAt: string; expiresAt: string; paymentValidUntil: string;
  status: "creating" | "open" | "processing" | "paid" | "failed" | "unknown";
  checkoutUrl: string | null; remoteId?: string; paidRemoteId?: string;
  cancelConfirmed?: boolean; failureNotified?: boolean;
  customer: StripeCheckoutSession["customer_details"];
  shipping: StripeCheckoutSession["collected_information"];
};
const prefix = () => `fiszy:${process.env.VERCEL_ENV ?? "local"}:autopay`;
export function autopayIntentKey(reference: string) {
  if (!/^ap_[a-f0-9]{32}$/.test(reference)) throw new Error("Invalid Autopay reference.");
  return `${prefix()}:intent:${reference}`;
}
export async function readAutopayIntent(reference: string): Promise<AutopayIntent | null> {
  const raw = await redisCommand<string>(["GET", autopayIntentKey(reference)]);
  if (!raw) return null;
  const intent = JSON.parse(raw) as AutopayIntent;
  if (intent.reference !== reference) throw new Error("Invalid stored Autopay intent.");
  return intent;
}
export async function reserveAutopayIntent(input: Omit<AutopayIntent, "orderId" | "reference" | "createdAt" | "status" | "checkoutUrl">) {
  const orderId = randomUUID().replaceAll("-", "");
  const intent: AutopayIntent = { ...input, orderId, reference: `ap_${orderId}`, createdAt: new Date().toISOString(), status: "creating", checkoutUrl: null };
  const identity = createHash("sha256").update([input.kind, input.auctionId, input.runId, input.bidderId, input.claimToken ?? "", input.discountId ?? "", input.reservationToken ?? ""].join("\0")).digest("hex");
  const raw = await redisCommand<string>(["EVAL", `
local existingKey = redis.call("GET", KEYS[1])
if existingKey then
 local raw = redis.call("GET", existingKey)
 if raw then
  local current = cjson.decode(raw)
  if current.status ~= "failed" then return cjson.encode({created=false,intent=current}) end
 end
end
redis.call("SET", KEYS[1], KEYS[2])
redis.call("SET", KEYS[2], ARGV[1])
redis.call("ZADD", KEYS[3], ARGV[2], ARGV[3])
return cjson.encode({created=true,intent=cjson.decode(ARGV[1])})
`, 3, `${prefix()}:attempt:${identity}`, autopayIntentKey(intent.reference), `${prefix()}:intents`, JSON.stringify(intent), Date.now(), intent.reference]);
  if (!raw) throw new Error("Unable to reserve Autopay intent.");
  return JSON.parse(raw) as { created: boolean; intent: AutopayIntent };
}

// Provider events may arrive before the create HTTP response. Merge atomically;
// neither a delayed create result nor FAILURE/PENDING can erase a paid status.
export async function updateAutopayIntent(reference: string, patch: Partial<AutopayIntent>) {
  const raw = await redisCommand<string>(["EVAL", `
local raw = redis.call("GET", KEYS[1])
if not raw then return "" end
local current = cjson.decode(raw)
local patch = cjson.decode(ARGV[1])
local preserveStatus = current.status == "paid" or (current.status == "processing" and (patch.status == "open" or patch.status == "unknown")) or (current.status == "failed" and patch.status ~= "paid")
for key,value in pairs(patch) do
 if key ~= "status" or not preserveStatus then current[key] = value end
end
redis.call("SET", KEYS[1], cjson.encode(current))
return cjson.encode(current)
`, 1, autopayIntentKey(reference), JSON.stringify(patch)]);
  if (!raw) throw new Error("Autopay intent not found.");
  return JSON.parse(raw) as AutopayIntent;
}

export async function claimAutopayPaidRemote(reference: string, remoteId: string) {
  const raw = await redisCommand<string>(["EVAL", `
local raw = redis.call("GET", KEYS[1])
if not raw then return "" end
local intent = cjson.decode(raw)
if not intent.paidRemoteId then intent.paidRemoteId = ARGV[1] end
intent.status = "paid"
redis.call("SET", KEYS[1], cjson.encode(intent))
return intent.paidRemoteId
`, 1, autopayIntentKey(reference), remoteId]);
  if (!raw) throw new Error("Autopay paid intent not found.");
  return raw;
}

export type AutopayRefund = { messageId: string; reference: string; remoteId: string; amount: number; state: "requested" | "submitted" | "completed" | "failed"; updatedAt: string };
export function autopayRefundId(reference: string, remoteId: string) {
  return createHash("sha256").update(`refund\0${reference}\0${remoteId}`).digest("hex").slice(0, 32);
}
function refundKey(id: string) {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new Error("Invalid Autopay refund id.");
  return `${prefix()}:refund:${id}`;
}
export async function readAutopayRefund(id: string): Promise<AutopayRefund | null> {
  const raw = await redisCommand<string>(["GET", refundKey(id)]);
  return raw ? JSON.parse(raw) as AutopayRefund : null;
}
export async function storeAutopayRefund(refund: AutopayRefund) {
  await redisCommand(["EVAL", `
local raw = redis.call("GET", KEYS[1])
if raw then
 local old = cjson.decode(raw)
 local next = cjson.decode(ARGV[1])
 if old.state == "completed" or (old.state == "failed" and next.state ~= "completed") then return 0 end
end
redis.call("SET", KEYS[1], ARGV[1])
redis.call("ZADD", KEYS[2], ARGV[2], ARGV[3])
return 1
`, 2, refundKey(refund.messageId), `${prefix()}:refunds`, JSON.stringify(refund), Date.parse(refund.updatedAt), refund.messageId]);
}

export async function readAutopayEntryIntent(auctionId: string, runId: string, bidderId: string) {
  const identity = createHash("sha256").update(["auction_entry", auctionId, runId, bidderId, "", "", ""].join("\0")).digest("hex");
  const key = await redisCommand<string>(["GET", `${prefix()}:attempt:${identity}`]);
  if (!key) return null;
  const raw = await redisCommand<string>(["GET", key]);
  return raw ? JSON.parse(raw) as AutopayIntent : null;
}

export async function autopayOperationalIssues() {
  const [intentRefs, refundIds] = await Promise.all([
    redisCommand<string[]>(["ZREVRANGE", `${prefix()}:intents`, 0, 99]),
    redisCommand<string[]>(["ZREVRANGE", `${prefix()}:refunds`, 0, 99]),
  ]);
  const [intents, refunds] = await Promise.all([
    Promise.all((intentRefs ?? []).map(readAutopayIntent)),
    Promise.all((refundIds ?? []).map(readAutopayRefund)),
  ]);
  const cutoff = Date.now() - 30 * 60_000;
  return {
    stalePayments: intents.filter((intent): intent is AutopayIntent => Boolean(intent && !["paid", "failed"].includes(intent.status) && Date.parse(intent.paymentValidUntil) < cutoff)).map(intent => ({ reference: intent.reference, status: intent.status, createdAt: intent.createdAt })),
    refundsRequiringAttention: refunds.filter((refund): refund is AutopayRefund => Boolean(refund && (refund.state === "failed" || (refund.state !== "completed" && Date.parse(refund.updatedAt) < Date.now() - 7 * 86_400_000)))).map(refund => ({ messageId: refund.messageId, reference: refund.reference, state: refund.state, amount: refund.amount, updatedAt: refund.updatedAt })),
    inspectedRecentPayments: intentRefs?.length ?? 0,
    inspectedRecentRefunds: refundIds?.length ?? 0,
  };
}
