import { createHash } from "node:crypto";
import { redisCommand } from "./redis";

export const LANDING_EVENTS = ["scroll_25", "scroll_50", "scroll_75", "scroll_100", "form_started", "cta_attempt", "signup"] as const;
export type LandingEvent = (typeof LANDING_EVENTS)[number];

type DailyTraffic = {
  schemaVersion: 1;
  date: string;
  views: number;
  uniqueSessions: number;
  activeSeconds: number;
  timedSessions: number;
  events: Record<LandingEvent, number>;
  sources: Record<string, { label: string; views: number; signups: number }>;
  updatedAt: string;
};

const RETENTION_SECONDS = 400 * 24 * 60 * 60;
const SESSION_PATTERN = /^[a-f0-9-]{20,80}$/i;

function prefix() { return `fiszy:${process.env.VERCEL_ENV ?? "local"}`; }
function dayKey(date: string) { return `${prefix()}:traffic:v1:day:${date}`; }
function dedupeKey(date: string, kind: string, sessionId: string) { return `${prefix()}:traffic:v1:dedupe:${date}:${kind}:${sessionId}`; }
function dateInWarsaw(now: number) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
}
function emptyEvents() { return Object.fromEntries(LANDING_EVENTS.map((event) => [event, 0])) as Record<LandingEvent, number>; }

export function validLandingSession(value: unknown): value is string {
  return typeof value === "string" && SESSION_PATTERN.test(value);
}

export function landingSource(value: unknown) {
  const source = typeof value === "string" ? value.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 80) : "";
  return source && /^[a-z0-9][a-z0-9._:/ -]{0,79}$/.test(source) ? source : "direct";
}

async function write(input: { sessionId: string; source: string; kind: "view" | "event" | "duration"; event?: LandingEvent; seconds?: number; now?: number }) {
  const now = input.now ?? Date.now();
  const date = dateInWarsaw(now);
  const source = landingSource(input.source);
  const sourceId = createHash("sha256").update(source).digest("hex").slice(0, 20);
  const kind = input.kind === "event" ? `event:${input.event}` : input.kind;
  const dedupe = dedupeKey(date, kind, input.sessionId);
  const unique = dedupeKey(date, "unique", input.sessionId);
  const event = input.event ?? "";
  const seconds = Math.max(0, Math.min(60 * 60, Math.round(input.seconds ?? 0)));
  const result = await redisCommand<string>([
    "EVAL", `
local raw = redis.call("GET", KEYS[1])
local record
if raw then
  local ok, parsed = pcall(cjson.decode, raw)
  if not ok or type(parsed) ~= "table" or parsed.schemaVersion ~= 1 or parsed.date ~= ARGV[1] then return nil end
  record = parsed
else
  record = {schemaVersion=1,date=ARGV[1],views=0,uniqueSessions=0,activeSeconds=0,timedSessions=0,events={},sources={}}
end
if redis.call("SET", KEYS[2], "1", "NX", "EX", ARGV[6]) then record.uniqueSessions = tonumber(record.uniqueSessions or 0) + 1 end
if redis.call("SET", KEYS[3], "1", "NX", "EX", ARGV[6]) then
  if ARGV[2] == "view" then record.views = tonumber(record.views or 0) + 1 end
  if ARGV[2] == "duration" then record.activeSeconds = tonumber(record.activeSeconds or 0) + tonumber(ARGV[5]); record.timedSessions = tonumber(record.timedSessions or 0) + 1 end
  if ARGV[2] == "event" then record.events[ARGV[4]] = tonumber(record.events[ARGV[4]] or 0) + 1 end
  local current = record.sources[ARGV[3]] or {label=ARGV[7],views=0,signups=0}
  if ARGV[2] == "view" then current.views = tonumber(current.views or 0) + 1 end
  if ARGV[2] == "event" and ARGV[4] == "signup" then current.signups = tonumber(current.signups or 0) + 1 end
  record.sources[ARGV[3]] = current
end
record.updatedAt = ARGV[8]
local encoded = cjson.encode(record)
redis.call("SET", KEYS[1], encoded, "EX", ARGV[6])
return encoded`,
    3, dayKey(date), unique, dedupe, date, input.kind, sourceId, event, seconds, RETENTION_SECONDS, source, new Date(now).toISOString(),
  ]);
  if (!result) throw new Error("Unable to write landing traffic.");
}

export async function recordLandingView(input: { sessionId: string; source: string; now?: number }) { await write({ ...input, kind: "view" }); }
export async function recordLandingEvent(input: { sessionId: string; source: string; event: LandingEvent; now?: number }) { await write({ ...input, kind: "event" }); }
export async function recordLandingDuration(input: { sessionId: string; source: string; seconds: number; now?: number }) { await write({ ...input, kind: "duration" }); }

function parseDay(raw: unknown): DailyTraffic | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<DailyTraffic>;
    if (value.schemaVersion !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(value.date ?? "")) return null;
    const number = (candidate: unknown) => Number.isSafeInteger(candidate) && Number(candidate) >= 0 ? Number(candidate) : null;
    const views = number(value.views); const uniqueSessions = number(value.uniqueSessions); const activeSeconds = number(value.activeSeconds); const timedSessions = number(value.timedSessions);
    if (views === null || uniqueSessions === null || activeSeconds === null || timedSessions === null || !value.events || !value.sources) return null;
    const events = emptyEvents();
    for (const event of LANDING_EVENTS) { const count = number(value.events[event]); if (count === null) return null; events[event] = count; }
    const sources: DailyTraffic["sources"] = {};
    for (const [id, item] of Object.entries(value.sources)) {
      if (!/^[a-f0-9]{20}$/.test(id) || !item || typeof item !== "object") continue;
      const source = item as { label?: unknown; views?: unknown; signups?: unknown };
      const sourceViews = number(source.views); const signups = number(source.signups);
      if (typeof source.label !== "string" || sourceViews === null || signups === null) continue;
      sources[id] = { label: source.label, views: sourceViews, signups };
    }
    return { schemaVersion: 1, date: value.date!, views, uniqueSessions, activeSeconds, timedSessions, events, sources, updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "" };
  } catch { return null; }
}

export async function readLandingTraffic(days = 30, now = Date.now()) {
  if (!Number.isInteger(days) || days < 1 || days > 90) return null;
  const dates = Array.from({ length: days }, (_, offset) => dateInWarsaw(now - offset * 86_400_000)).reverse();
  const raw = await redisCommand<Array<string | null>>(["MGET", ...dates.map(dayKey)]);
  const daily = dates.map((date, index) => parseDay(raw?.[index]) ?? { schemaVersion: 1 as const, date, views: 0, uniqueSessions: 0, activeSeconds: 0, timedSessions: 0, events: emptyEvents(), sources: {}, updatedAt: "" });
  const totals = { views: 0, uniqueSessions: 0, activeSeconds: 0, timedSessions: 0, events: emptyEvents() };
  const sourceMap = new Map<string, { views: number; signups: number }>();
  for (const day of daily) {
    totals.views += day.views; totals.uniqueSessions += day.uniqueSessions; totals.activeSeconds += day.activeSeconds; totals.timedSessions += day.timedSessions;
    for (const event of LANDING_EVENTS) totals.events[event] += day.events[event];
    for (const source of Object.values(day.sources)) {
      const current = sourceMap.get(source.label) ?? { views: 0, signups: 0 };
      current.views += source.views; current.signups += source.signups; sourceMap.set(source.label, current);
    }
  }
  const percent = (value: number, base: number) => base ? Math.round(value / base * 10_000) / 100 : 0;
  return {
    days, daily, totals,
    conversion: {
      formStarted: percent(totals.events.form_started, totals.uniqueSessions),
      ctaAttempt: percent(totals.events.cta_attempt, totals.uniqueSessions),
      signup: percent(totals.events.signup, totals.uniqueSessions),
    },
    averageActiveSeconds: totals.timedSessions ? Math.round(totals.activeSeconds / totals.timedSessions) : 0,
    sources: [...sourceMap.entries()].map(([label, value]) => ({ label, ...value, signupRate: percent(value.signups, value.views) })).sort((a, b) => b.views - a.views).slice(0, 20),
  };
}
