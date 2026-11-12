import { randomUUID } from "node:crypto";
import { readCampaignDelivery } from "./campaign-delivery";
import { readClerkAccountEmail } from "./account-email";
import { campaignEmailFingerprint, campaignUnsubscribeConfigured, campaignUnsubscribeUrl, isCampaignEmailSuppressed } from "./campaign-unsubscribe";
import { listAccountProfiles, readAccountProfile } from "./portal-storage";
import { redisCommand } from "./redis";
import { siteUrl } from "./site";
import { sendCampaignMessage, transactionalEmailConfigured } from "./transactional-email";

type Segment = "all" | "recent";
type State = "draft" | "queued" | "paused" | "completed" | "cancelled";
type Content = { name: string; subject: string; text: string; imageUrl: string; ctaLabel: string; ctaUrl: string; segment: Segment };
type Pending = { fingerprint: string; since: number; attempts: number };
type Campaign = Content & {
  id: string; revision: number; state: State; createdAt: string; updatedAt: string;
  scheduledAt: string | null; nextAt: number; recipients: string[]; processed: number;
  accepted: number; skipped: number; failed: number; seen: string[]; pending: Pending | null;
};

const MAX_RECIPIENTS = 500;
const BATCH_SIZE = 15;
const ID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const prefix = () => `fiszy:${process.env.VERCEL_ENV ?? "local"}:marketing:campaigns`;
const key = (id: string) => `${prefix()}:item:${id}`;
const index = () => `${prefix()}:history`;
const due = () => `${prefix()}:due`;
const lock = (id: string) => `${prefix()}:lock:${id}`;

export class CampaignError extends Error {
  constructor(public readonly code: string, public readonly status = 409) { super(code); }
}

export function campaignSendingConfigured() {
  return transactionalEmailConfigured() && campaignUnsubscribeConfigured() &&
    Boolean(process.env.CLERK_SECRET_KEY?.startsWith("sk_")) &&
    ["production", "local", undefined].includes(process.env.VERCEL_ENV);
}

export function campaignTestRecipient() {
  const email = process.env.FISZY_CAMPAIGN_TEST_EMAIL?.trim().toLowerCase();
  return email && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function field(value: unknown, limit: number, multiline = false) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  const control = multiline ? /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/ : /[\x00-\x1F\x7F]/;
  return text.length <= limit && !control.test(text) ? text : null;
}

export function normalizeCampaign(input: unknown): Content | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const values = input as Record<string, unknown>;
  const name = field(values.name, 100);
  const subject = field(values.subject, 150);
  const text = field(values.text, 12000, true);
  const rawImageUrl = field(values.imageUrl ?? "", 1_000);
  const ctaLabel = field(values.ctaLabel ?? "", 80);
  const rawUrl = field(values.ctaUrl ?? "", 450);
  if (!name || !subject || !text || rawImageUrl === null || ctaLabel === null || rawUrl === null || Boolean(ctaLabel) !== Boolean(rawUrl)) return null;
  if (values.segment !== "all" && values.segment !== "recent") return null;
  let ctaUrl = "";
  if (rawUrl) {
    try {
      const url = new URL(rawUrl, siteUrl());
      if (url.origin !== siteUrl() || url.protocol !== "https:" || url.username || url.password || url.pathname.startsWith("/api/")) return null;
      ctaUrl = url.toString();
    } catch { return null; }
  }
  let imageUrl = "";
  if (rawImageUrl) {
    try {
      const url = new URL(rawImageUrl);
      if (url.protocol !== "https:" || url.username || url.password) return null;
      imageUrl = url.toString();
    } catch { return null; }
  }
  return { name, subject, text, imageUrl, ctaLabel, ctaUrl, segment: values.segment };
}

function summary(campaign: Campaign) {
  const { recipients, seen, pending, nextAt, ...visible } = campaign;
  return { ...visible, audience: recipients.length };
}

export async function readCampaignStats(id: string) {
  await read(id);
  return readCampaignDelivery(id);
}

async function read(id: string) {
  if (!ID.test(id)) throw new CampaignError("not_found", 404);
  const raw = await redisCommand<string>(["GET", key(id)]);
  if (!raw) throw new CampaignError("not_found", 404);
  return JSON.parse(raw) as Campaign;
}

export async function listCampaigns() {
  const ids = await redisCommand<string[]>(["ZREVRANGE", index(), 0, 49]) ?? [];
  const rows = ids.length ? await redisCommand<Array<string | null>>(["MGET", ...ids.map(key)]) : [];
  return (rows ?? []).flatMap((row) => row ? [summary(JSON.parse(row) as Campaign)] : []);
}

async function withLock<T>(id: string, action: (token: string) => Promise<T>) {
  if (!ID.test(id)) throw new CampaignError("not_found", 404);
  const token = randomUUID();
  if (await redisCommand<string>(["SET", lock(id), token, "NX", "PX", 90_000]) !== "OK") throw new CampaignError("busy");
  try {
    return await action(token);
  } finally {
    await redisCommand(["EVAL", 'if redis.call("GET", KEYS[1]) == ARGV[1] then return redis.call("DEL", KEYS[1]) end return 0', 1, lock(id), token]).catch(() => {});
  }
}

async function store(campaign: Campaign, token: string) {
  campaign.updatedAt = new Date().toISOString();
  const result = await redisCommand<number>(["EVAL", `
if redis.call("GET", KEYS[1]) ~= ARGV[1] then return 0 end
redis.call("SET", KEYS[2], ARGV[2])
redis.call("ZADD", KEYS[3], ARGV[3], ARGV[4])
if ARGV[5] == "queued" then redis.call("ZADD", KEYS[4], ARGV[6], ARGV[4])
else redis.call("ZREM", KEYS[4], ARGV[4]) end
return 1
`, 4, lock(campaign.id), key(campaign.id), index(), due(), token, JSON.stringify(campaign), Date.parse(campaign.createdAt), campaign.id, campaign.state, campaign.nextAt]);
  if (result !== 1) throw new CampaignError("busy");
}

function requireRevision(campaign: Campaign, revision: unknown) {
  if (campaign.revision !== revision) throw new CampaignError("revision_conflict");
}

export async function saveCampaign(input: unknown, id?: string, revision?: unknown) {
  const content = normalizeCampaign(input);
  if (!content) throw new CampaignError("invalid_content", 400);
  const campaignId = id ?? randomUUID();
  return withLock(campaignId, async (token) => {
    const now = new Date().toISOString();
    const existing = id ? await read(id) : null;
    if (existing) {
      requireRevision(existing, revision);
      if (existing.state !== "draft") throw new CampaignError("not_draft");
    }
    const campaign: Campaign = existing
      ? { ...existing, ...content, revision: existing.revision + 1 }
      : { ...content, id: campaignId, revision: 1, state: "draft", createdAt: now, updatedAt: now,
          scheduledAt: null, nextAt: 0, recipients: [], processed: 0, accepted: 0, skipped: 0, failed: 0, seen: [], pending: null };
    await store(campaign, token);
    return summary(campaign);
  });
}

export async function campaignAudience(segment: Segment) {
  if (segment !== "all" && segment !== "recent") throw new CampaignError("invalid_segment", 400);
  const ids: string[] = [];
  const cutoff = Date.now() - 30 * 86400_000;
  let cursor: string | null = null;
  for (let page = 0; page < 100; page += 1) {
    const result = await listAccountProfiles({ cursor, limit: 50 });
    if (!result) throw new CampaignError("audience_unavailable", 503);
    for (const profile of result.profiles) {
      if (!profile.preferences.marketing || profile.deletionRequestedAt) continue;
      if (segment === "recent" && Date.parse(profile.createdAt) < cutoff) continue;
      ids.push(profile.accountId);
      if (ids.length > MAX_RECIPIENTS) throw new CampaignError("audience_too_large");
    }
    cursor = result.nextCursor;
    if (!cursor) return [...new Set(ids)];
  }
  throw new CampaignError("audience_too_large");
}

export async function changeCampaign(id: string, revision: unknown, action: string, scheduledAt: unknown) {
  // Resolve the segment before acquiring the write lock. Re-check the revision before committing the snapshot.
  let recipients: string[] | null = null;
  let schedule: number | null = null;
  if (action === "queue") {
    if (!campaignSendingConfigured()) throw new CampaignError("email_not_configured", 503);
    const draft = await read(id);
    requireRevision(draft, revision);
    if (draft.state !== "draft") throw new CampaignError("not_draft");
    schedule = typeof scheduledAt === "string" ? Date.parse(scheduledAt) : Date.now();
    if (!Number.isFinite(schedule) || schedule < Date.now() - 60_000 || schedule > Date.now() + 30 * 86400_000) throw new CampaignError("invalid_schedule", 400);
    recipients = await campaignAudience(draft.segment);
    if (!recipients.length) throw new CampaignError("empty_audience");
  }
  return withLock(id, async (token) => {
    const campaign = await read(id);
    requireRevision(campaign, revision);
    if (action === "queue" && recipients && schedule !== null && campaign.state === "draft") {
      campaign.recipients = recipients;
      campaign.scheduledAt = new Date(schedule).toISOString();
      campaign.nextAt = schedule;
      campaign.state = "queued";
    } else if (action === "pause" && campaign.state === "queued") campaign.state = "paused";
    else if (action === "resume" && campaign.state === "paused") campaign.state = "queued";
    else if (action === "cancel" && (campaign.state === "queued" || campaign.state === "paused")) campaign.state = "cancelled";
    else throw new CampaignError("invalid_transition");
    campaign.revision += 1;
    await store(campaign, token);
    return summary(campaign);
  });
}

function send(campaign: Campaign, email: string, fingerprint: string, isTest = false) {
  return sendCampaignMessage({
    to: email,
    subject: isTest ? `[TEST] ${campaign.subject}` : campaign.subject,
    text: campaign.text,
    imageUrl: campaign.imageUrl,
    ctaLabel: campaign.ctaLabel,
    ctaUrl: campaign.ctaUrl,
    unsubscribeUrl: campaignUnsubscribeUrl(fingerprint),
    campaignId: isTest ? undefined : campaign.id,
    idempotencyKey: isTest ? `campaign-test-${campaign.id}-${campaign.revision}-${fingerprint}` : `campaign-${campaign.id}-${fingerprint}`,
  });
}

export async function testCampaign(id: string) {
  const email = campaignTestRecipient();
  if (!email || !campaignSendingConfigured()) throw new CampaignError("test_not_configured", 503);
  const campaign = await read(id);
  const fingerprint = campaignEmailFingerprint(email);
  if (await isCampaignEmailSuppressed(fingerprint)) throw new CampaignError("test_recipient_unsubscribed");
  await send(campaign, email, fingerprint, true);
}

export async function processCampaign(id: string) {
  if (!campaignSendingConfigured()) throw new CampaignError("email_not_configured", 503);
  const deadline = Date.now() + 30_000;
  return withLock(id, async (token) => {
    const campaign = await read(id);
    if (campaign.state !== "queued" || campaign.nextAt > Date.now()) return summary(campaign);
    for (let i = 0; i < BATCH_SIZE && campaign.processed < campaign.recipients.length && Date.now() < deadline; i += 1) {
      const profile = await readAccountProfile(campaign.recipients[campaign.processed]);
      const email = profile?.preferences.marketing && !profile.deletionRequestedAt
        ? await readClerkAccountEmail(profile.accountId, { verifiedOnly: true }) : null;
      const fingerprint = email ? campaignEmailFingerprint(email) : null;
      const pending = campaign.pending;
      if (!email || !fingerprint || campaign.seen.includes(fingerprint) || await isCampaignEmailSuppressed(fingerprint) ||
          (pending && (pending.fingerprint !== fingerprint || pending.attempts >= 3 || Date.now() - pending.since >= 20 * 3600_000))) {
        if (pending) {
          campaign.failed += 1;
          campaign.seen.push(pending.fingerprint);
        } else campaign.skipped += 1;
      } else {
        const permit = await redisCommand<string>(["SET", `${prefix()}:provider-slot`, "1", "NX", "PX", 550]);
        if (permit !== "OK") {
          // Preserve the current recipient if a parallel send is occupying the provider slot.
          await new Promise((resolve) => setTimeout(resolve, 550));
          i -= 1;
          continue;
        }
        campaign.pending = { fingerprint, since: pending?.since ?? Date.now(), attempts: (pending?.attempts ?? 0) + 1 };
        await store(campaign, token);
        try {
          await send(campaign, email, fingerprint);
          campaign.accepted += 1;
        } catch {
          if (campaign.pending.attempts < 3) {
            campaign.nextAt = Date.now() + 60_000;
            await store(campaign, token);
            return summary(campaign);
          }
          campaign.failed += 1;
        }
        campaign.seen.push(fingerprint);
      }
      campaign.pending = null;
      campaign.processed += 1;
      if (campaign.processed === campaign.recipients.length) campaign.state = "completed";
      await store(campaign, token);
    }
    return summary(campaign);
  });
}

export async function processDueCampaign() {
  if (!campaignSendingConfigured()) return null;
  const ids = await redisCommand<string[]>(["ZRANGEBYSCORE", due(), "-inf", Date.now(), "LIMIT", 0, 1]) ?? [];
  if (!ids.length) return null;
  try { return await processCampaign(ids[0]); }
  catch (error) { if (error instanceof CampaignError && error.code === "busy") return null; throw error; }
}
