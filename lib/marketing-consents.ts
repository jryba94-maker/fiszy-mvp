import { readClerkAccountEmail } from "./account-email";
import { listAccountProfiles } from "./portal-storage";
import { listAccountPrivacyConsentEvents, type PrivacyConsentEvent } from "./privacy-storage";
import { listRecentWaitlistSignups } from "./waitlist-storage";

export type MarketingConsentRow = {
  accountId: string;
  email: string;
  status: "active" | "withdrawn";
  source: string;
  updatedAt: string;
  history: PrivacyConsentEvent[];
};

export type MarketingConsentDashboard = {
  rows: MarketingConsentRow[];
  totals: { active: number; withdrawn: number; pending: number };
  daily: Array<{ date: string; active: number; granted: number; withdrawn: number }>;
  limited: boolean;
};

async function mapLimit<T, R>(values: T[], limit: number, action: (value: T) => Promise<R>) {
  const result: R[] = [];
  for (let start = 0; start < values.length; start += limit) {
    result.push(...await Promise.all(values.slice(start, start + limit).map(action)));
  }
  return result;
}

function day(value: string) {
  return new Date(value).toLocaleDateString("en-CA", { timeZone: "Europe/Warsaw" });
}

function dailyRows(rows: MarketingConsentRow[], days: number) {
  const dates = Array.from({ length: days }, (_, index) => {
    const value = new Date();
    value.setUTCDate(value.getUTCDate() - (days - index - 1));
    return value.toLocaleDateString("en-CA", { timeZone: "Europe/Warsaw" });
  });
  const firstDate = dates[0];
  const baseline = rows.filter((row) => {
    const before = row.history
      .filter((event) => day(event.occurredAt) < firstDate)
      .sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt))[0];
    return before ? before.granted : row.history.length === 0 && row.status === "active";
  }).length;
  const events = rows.flatMap((row) => row.history).filter((event) => event.purpose === "marketing");
  let active = baseline;
  return dates.map((date) => {
    const today = events.filter((event) => day(event.occurredAt) === date);
    const granted = today.filter((event) => event.granted).length;
    const withdrawn = today.filter((event) => !event.granted).length;
    active += granted - withdrawn;
    return { date, active: Math.max(0, active), granted, withdrawn };
  });
}

export async function readMarketingConsentDashboard(days = 30): Promise<MarketingConsentDashboard> {
  const profiles = [];
  let cursor: string | null = null;
  for (let page = 0; page < 10; page += 1) {
    const result = await listAccountProfiles({ cursor, limit: 50 });
    if (!result) throw new Error("Account profiles unavailable.");
    profiles.push(...result.profiles.filter((profile) => !profile.deletionRequestedAt));
    cursor = result.nextCursor;
    if (!cursor) break;
  }
  const rows = await mapLimit(profiles, 8, async (profile) => {
    const [email, history] = await Promise.all([
      readClerkAccountEmail(profile.accountId).catch(() => null),
      listAccountPrivacyConsentEvents(profile.accountId, "marketing"),
    ]);
    if (!email) return null;
    const latest = history[0];
    return {
      accountId: profile.accountId,
      email,
      status: profile.preferences.marketing ? "active" as const : "withdrawn" as const,
      source: latest ? "Moje Fiszy" : "Profil użytkownika",
      updatedAt: latest?.occurredAt ?? profile.updatedAt,
      history,
    } satisfies MarketingConsentRow;
  });
  const waitlist = await listRecentWaitlistSignups();
  const waitlistRows = waitlist.signups.map((signup) => {
    const source = [signup.source.utmSource, signup.source.utmCampaign].filter(Boolean).join(" / ") || signup.source.referrerHost || "wejście bezpośrednie";
    const event: PrivacyConsentEvent = { schemaVersion: 1, eventId: `WAITLIST-${signup.subscriberId.slice(0, 12)}`, accountId: `waitlist:${signup.subscriberId}`, purpose: "marketing", granted: true, policyVersion: "portal-v1-2026-08-25", occurredAt: signup.createdAt };
    return { accountId: `waitlist:${signup.subscriberId}`, email: signup.email, status: "active" as const, source: `Pierwsza aukcja · ${source}`, updatedAt: signup.createdAt, history: [event] };
  });
  const byEmail = new Map<string, MarketingConsentRow>();
  for (const row of [...rows.flatMap((row) => row ? [row] : []), ...waitlistRows]) {
    const current = byEmail.get(row.email);
    if (!current || Date.parse(row.updatedAt) > Date.parse(current.updatedAt)) byEmail.set(row.email, row);
  }
  const visible = [...byEmail.values()].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  return {
    rows: visible,
    totals: {
      active: visible.filter((row) => row.status === "active").length,
      withdrawn: visible.filter((row) => row.status === "withdrawn").length,
      pending: 0,
    },
    daily: dailyRows(visible, days),
    limited: Boolean(cursor),
  };
}
