import { createHash } from "node:crypto";
import { redisCommand } from "./redis";

export type LandingSource = { source?: string; medium?: string; campaign?: string; referrer?: string };
export type LandingTrafficSnapshot = {
  days: number;
  totals: { visits: number; uniqueSessions: number; durationSessions: number; totalDurationSeconds: number; averageDurationSeconds: number };
  sources: Array<{ label: string; visits: number }>;
};

const RETENTION_SECONDS = 400 * 24 * 60 * 60;
const MAX_DURATION_SECONDS = 60 * 60;
function prefix() { return `fiszy:${process.env.VERCEL_ENV ?? "local"}:landing-traffic:v1`; }
function day(date: number) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Warsaw", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(date)); }
function recordKey(date: string) { return `${prefix()}:day:${date}`; }
function sessionKey(date: string, id: string, kind: string) { return `${prefix()}:${kind}:${date}:${id}`; }
function safeValue(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const result = value.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 80);
  return result && /^[a-z0-9][a-z0-9._:/ -]{0,79}$/.test(result) ? result : fallback;
}
function sourceLabel(source: LandingSource) {
  const sourceValue = safeValue(source.source, "direct");
  const campaign = safeValue(source.campaign, "");
  return campaign ? `${sourceValue} / ${campaign}` : sourceValue;
}
function validSession(value: unknown) { return typeof value === "string" && /^[a-z0-9-]{16,80}$/i.test(value); }

export async function recordLandingVisit(input: { sessionId: string; source: LandingSource; now?: number }) {
  if (!validSession(input.sessionId)) return;
  const now = input.now ?? Date.now(); const date = day(now); const label = sourceLabel(input.source);
  const sourceId = createHash("sha256").update(label).digest("hex").slice(0, 20);
  await redisCommand<string>(["EVAL", `
local raw = redis.call("GET", KEYS[1])
local record = raw and cjson.decode(raw) or {schemaVersion=1, visits=0, uniqueSessions=0, durationSessions=0, totalDurationSeconds=0, sources={}}
record.visits = tonumber(record.visits or 0) + 1
if redis.call("SET", KEYS[2], "1", "NX", "EX", ARGV[3]) then record.uniqueSessions = tonumber(record.uniqueSessions or 0) + 1 end
local existing = record.sources[ARGV[1]] or {label=ARGV[2], visits=0}
existing.visits = tonumber(existing.visits or 0) + 1
record.sources[ARGV[1]] = existing
redis.call("SET", KEYS[1], cjson.encode(record), "EX", ARGV[3])
return "ok"`, 2, recordKey(date), sessionKey(date, input.sessionId, "visit"), sourceId, label, RETENTION_SECONDS]);
}

export async function recordLandingDuration(input: { sessionId: string; durationSeconds: number; now?: number }) {
  if (!validSession(input.sessionId) || !Number.isFinite(input.durationSeconds)) return;
  const seconds = Math.min(MAX_DURATION_SECONDS, Math.max(0, Math.round(input.durationSeconds)));
  if (seconds < 1) return;
  const now = input.now ?? Date.now(); const date = day(now);
  await redisCommand<string>(["EVAL", `
if not redis.call("SET", KEYS[2], "1", "NX", "EX", ARGV[2]) then return "duplicate" end
local raw = redis.call("GET", KEYS[1])
local record = raw and cjson.decode(raw) or {schemaVersion=1, visits=0, uniqueSessions=0, durationSessions=0, totalDurationSeconds=0, sources={}}
record.durationSessions = tonumber(record.durationSessions or 0) + 1
record.totalDurationSeconds = tonumber(record.totalDurationSeconds or 0) + tonumber(ARGV[1])
redis.call("SET", KEYS[1], cjson.encode(record), "EX", ARGV[2])
return "ok"`, 2, recordKey(date), sessionKey(date, input.sessionId, "duration"), seconds, RETENTION_SECONDS]);
}

export async function readLandingTraffic(days = 30, now = Date.now()): Promise<LandingTrafficSnapshot | null> {
  if (!Number.isInteger(days) || days < 1 || days > 90) return null;
  const dates = Array.from({ length: days }, (_, index) => day(now - index * 86_400_000));
  const raw = await redisCommand<Array<string | null>>(["MGET", ...dates.map(recordKey)]);
  const totals = { visits: 0, uniqueSessions: 0, durationSessions: 0, totalDurationSeconds: 0, averageDurationSeconds: 0 };
  const sources = new Map<string, number>();
  for (const value of raw ?? []) {
    if (!value) continue;
    try {
      const item = JSON.parse(value) as { visits?: number; uniqueSessions?: number; durationSessions?: number; totalDurationSeconds?: number; sources?: Record<string, { label?: string; visits?: number }> };
      for (const key of ["visits", "uniqueSessions", "durationSessions", "totalDurationSeconds"] as const) totals[key] += Math.max(0, Number(item[key]) || 0);
      for (const row of Object.values(item.sources ?? {})) if (typeof row.label === "string" && Number.isFinite(row.visits)) sources.set(row.label, (sources.get(row.label) ?? 0) + Number(row.visits));
    } catch { /* Ignore invalid historical records. */ }
  }
  totals.averageDurationSeconds = totals.durationSessions ? Math.round(totals.totalDurationSeconds / totals.durationSessions) : 0;
  return { days, totals, sources: [...sources.entries()].map(([label, visits]) => ({ label, visits })).sort((a, b) => b.visits - a.visits).slice(0, 10) };
}
