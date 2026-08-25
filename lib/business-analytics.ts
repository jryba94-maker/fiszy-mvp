import { createHash } from "node:crypto";
import { errorDetails, logEvent } from "./observability";
import { redisCommand } from "./redis";

export const BUSINESS_EVENTS = [
  "waitlist_signup",
  "entry_checkout_started",
  "entry_paid",
  "winner_claimed",
  "order_paid",
  "discount_redeemed",
  "service_case_created",
] as const;
export type BusinessEvent = (typeof BUSINESS_EVENTS)[number];

type DailyFunnel = {
  schemaVersion: 1;
  date: string;
  counts: Record<BusinessEvent, number>;
  campaigns: Record<string, { label: string; signups: number }>;
  updatedAt: string;
};

const RETENTION_SECONDS = 400 * 24 * 60 * 60;
function prefix() { return `fiszy:${process.env.VERCEL_ENV ?? "local"}`; }
function dayKey(date: string) { return `${prefix()}:analytics:v1:day:${date}`; }
function emptyCounts() {
  return Object.fromEntries(BUSINESS_EVENTS.map((event) => [event, 0])) as Record<BusinessEvent, number>;
}
function dateInWarsaw(now: number) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
}
function campaignLabel(value: unknown) {
  if (typeof value !== "string") return "direct";
  const label = value.trim().replace(/\s+/g, " ").slice(0, 80).toLowerCase();
  return label && /^[a-z0-9][a-z0-9._:/ -]{0,79}$/.test(label) ? label : "direct";
}

export async function recordBusinessEvent(input: { event: BusinessEvent; campaign?: string | null; now?: number }) {
  if (!BUSINESS_EVENTS.includes(input.event)) throw new Error("Invalid business event.");
  const now = input.now ?? Date.now();
  const date = dateInWarsaw(now);
  const campaign = campaignLabel(input.campaign);
  const campaignId = createHash("sha256").update(campaign.toLowerCase()).digest("hex").slice(0, 20);
  const updated = await redisCommand<string>([
    "EVAL", `
local raw = redis.call("GET", KEYS[1])
local record
if raw then
  local ok, parsed = pcall(cjson.decode, raw)
  if not ok or type(parsed) ~= "table" or parsed.schemaVersion ~= 1 or parsed.date ~= ARGV[1] then return nil end
  record = parsed
else
  record = {schemaVersion=1, date=ARGV[1], counts={}, campaigns={}}
end
record.counts[ARGV[2]] = tonumber(record.counts[ARGV[2]] or 0) + 1
if ARGV[2] == "waitlist_signup" then
  local campaignKey = ARGV[3]
  local campaignLabel = ARGV[4]
  if not record.campaigns[campaignKey] then
    local campaignCount = 0
    for _ in pairs(record.campaigns) do campaignCount = campaignCount + 1 end
    if campaignCount >= 100 then campaignKey = ARGV[7]; campaignLabel = "other" end
  end
  local existing = record.campaigns[campaignKey] or {label=campaignLabel, signups=0}
  existing.signups = tonumber(existing.signups or 0) + 1
  record.campaigns[campaignKey] = existing
end
record.updatedAt = ARGV[5]
local encoded = cjson.encode(record)
redis.call("SET", KEYS[1], encoded, "EX", ARGV[6])
return encoded`, 1, dayKey(date), date, input.event, campaignId, campaign, new Date(now).toISOString(), RETENTION_SECONDS, createHash("sha256").update("other").digest("hex").slice(0, 20),
  ]);
  if (!updated) throw new Error("Unable to record business event.");
}

export async function recordBusinessEventSafely(input: { event: BusinessEvent; campaign?: string | null; now?: number }) {
  try { await recordBusinessEvent(input); }
  catch (error) { logEvent("business_analytics_write_failed", { event: input.event, ...errorDetails(error) }, "warning"); }
}

function parseDay(raw: unknown): DailyFunnel | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<DailyFunnel>;
    if (value.schemaVersion !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(value.date ?? "") || !value.counts || typeof value.counts !== "object") return null;
    const counts = emptyCounts();
    for (const event of BUSINESS_EVENTS) {
      const count = Number(value.counts[event] ?? 0);
      if (!Number.isSafeInteger(count) || count < 0) return null;
      counts[event] = count;
    }
    const campaigns: DailyFunnel["campaigns"] = {};
    if (value.campaigns !== undefined) {
      if (!value.campaigns || typeof value.campaigns !== "object" || Array.isArray(value.campaigns)) return null;
      const entries = Object.entries(value.campaigns);
      if (entries.length > 101) return null;
      for (const [id, item] of entries) {
        if (
          !/^[a-f0-9]{20}$/.test(id) ||
          !item || typeof item !== "object" || Array.isArray(item) ||
          campaignLabel((item as { label?: unknown }).label) !== (item as { label?: unknown }).label ||
          !Number.isSafeInteger((item as { signups?: unknown }).signups) ||
          Number((item as { signups?: unknown }).signups) < 0
        ) return null;
        campaigns[id] = { label: (item as { label: string }).label, signups: Number((item as { signups: number }).signups) };
      }
    }
    const updatedAt = typeof value.updatedAt === "string" && Number.isFinite(Date.parse(value.updatedAt)) ? value.updatedAt : "";
    return { schemaVersion: 1, date: value.date!, counts, campaigns, updatedAt };
  } catch { return null; }
}

export async function readBusinessFunnel(days = 30, now = Date.now()) {
  if (!Number.isInteger(days) || days < 1 || days > 90) return null;
  const dates = Array.from({ length: days }, (_, offset) => dateInWarsaw(now - offset * 24 * 60 * 60_000)).reverse();
  const raw = await redisCommand<Array<string | null>>(["MGET", ...dates.map(dayKey)]);
  const daily = dates.map((date, index) => parseDay(raw?.[index]) ?? { schemaVersion: 1 as const, date, counts: emptyCounts(), campaigns: {}, updatedAt: "" });
  const totals = emptyCounts();
  const campaigns = new Map<string, number>();
  for (const day of daily) {
    for (const event of BUSINESS_EVENTS) totals[event] += day.counts[event];
    for (const item of Object.values(day.campaigns)) campaigns.set(item.label, (campaigns.get(item.label) ?? 0) + Number(item.signups ?? 0));
  }
  const ratio = (value: number, base: number) => base > 0 ? Math.round(value / base * 10_000) / 100 : 0;
  return {
    days,
    daily,
    totals,
    conversion: {
      entryPaidFromCheckout: ratio(totals.entry_paid, totals.entry_checkout_started),
      winFromPaidEntry: ratio(totals.winner_claimed, totals.entry_paid),
      paidOrderFromWin: ratio(totals.order_paid, totals.winner_claimed),
    },
    campaigns: [...campaigns.entries()].map(([label, signups]) => ({ label, signups })).sort((a, b) => b.signups - a.signups).slice(0, 20),
  };
}
