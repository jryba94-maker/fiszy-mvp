import assert from "node:assert/strict";
import { redis } from "./local-redis-test-client.mjs";
import { ensureAccountProfile, updateAccountProfile } from "../lib/portal-storage.ts";
import { campaignAudience, changeCampaign, normalizeCampaign, processCampaign, processDueCampaign, readCampaignStats, saveCampaign, testCampaign } from "../lib/email-campaigns.ts";
import { campaignEmailFingerprint, campaignUnsubscribeUrl, suppressCampaignEmail } from "../lib/campaign-unsubscribe.ts";
import { recordCampaignDelivery } from "../lib/campaign-delivery.ts";

Object.assign(process.env, {
  VERCEL_ENV: "local",
  STORAGE_KV_REST_API_URL: "http://campaign-redis.invalid",
  STORAGE_KV_REST_API_TOKEN: "test",
  CLERK_SECRET_KEY: "sk_fixture",
  RESEND_API_KEY: "re_fixture",
  FISZY_EMAIL_FROM: "Fiszy <hello@example.invalid>",
  NEXT_PUBLIC_SITE_URL: "https://fiszy.pl",
  FISZY_CAMPAIGN_SECRET: "campaign-integration-test-signing-secret",
  FISZY_CAMPAIGN_TEST_EMAIL: "control@example.invalid",
});

const oldFetch = globalThis.fetch;
const sent = [];
const email = (accountId) => `${accountId}@example.invalid`;
globalThis.fetch = async (url, init = {}) => {
  if (String(url) === process.env.STORAGE_KV_REST_API_URL) {
    return Response.json({ result: await redis(JSON.parse(init.body)) });
  }
  if (String(url).startsWith("https://api.clerk.com/v1/users/")) {
    const accountId = String(url).split("/").at(-1);
    return Response.json({
      primary_email_address_id: "primary",
      email_addresses: [{ id: "primary", email_address: email(accountId), verification: { status: accountId.endsWith("unverified") ? "unverified" : "verified" } }],
    });
  }
  if (String(url) === "https://api.resend.com/emails") {
    sent.push({ ...JSON.parse(init.body), idempotencyKey: init.headers["Idempotency-Key"] });
    return Response.json({ id: `email-campaign-${sent.length}` });
  }
  throw new Error("Unexpected outbound request.");
};

async function consent(accountId, marketing) {
  const profile = await ensureAccountProfile(accountId);
  const updated = await updateAccountProfile({
    accountId,
    expectedRevision: profile.revision,
    patch: { fullName: "", phone: "", address: null, preferences: { ...profile.preferences, marketing } },
  });
  assert.ok(updated);
}

const content = { name: "Kampania testowa", subject: "Zaproszenie", text: "<script>Treść</script>", ctaLabel: "Sprawdź aukcję", ctaUrl: "/aukcje", segment: "recent" };
try {
  assert.equal(normalizeCampaign({ ...content, ctaUrl: "https://example.invalid" }), null);
  for (const suffix of ["valid", "withdrawn", "suppressed", "unverified"]) await consent(`user_marketing_${suffix}`, true);
  await consent("user_marketing_no_consent", false);
  assert.equal((await campaignAudience("recent")).length, 4);

  const draft = await saveCampaign(content);
  await assert.rejects(saveCampaign(content, draft.id, 999), { message: "revision_conflict" });
  await testCampaign(draft.id);
  assert.equal(sent[0].to[0], "control@example.invalid");
  assert.match(sent[0].subject, /^\[TEST\]/);
  assert.equal(sent[0].tags, undefined);

  const queued = await changeCampaign(draft.id, draft.revision, "queue", null);
  const paused = await changeCampaign(queued.id, queued.revision, "pause", null);
  assert.equal((await processCampaign(paused.id)).processed, 0);
  await consent("user_marketing_withdrawn", false);
  const token = new URL(campaignUnsubscribeUrl(campaignEmailFingerprint(email("user_marketing_suppressed")))).searchParams.get("token");
  assert.equal(await suppressCampaignEmail(token.replace(/.$/, (value) => value === "0" ? "1" : "0")), false);
  assert.equal(await suppressCampaignEmail(token), true);

  await changeCampaign(paused.id, paused.revision, "resume", null);
  const processed = await processDueCampaign();
  assert.deepEqual([processed.state, processed.audience, processed.accepted, processed.skipped, processed.failed], ["completed", 4, 1, 3, 0]);
  assert.equal(sent.length, 2);
  assert.equal(sent[1].to[0], "user_marketing_valid@example.invalid");
  assert.equal(sent[1].tags[0].value, draft.id);
  assert.equal(sent[1].headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert.ok(sent[1].html.includes("&lt;script&gt;"));
  assert.equal(await processDueCampaign(), null);

  const event = { campaignId: draft.id, providerMessageId: "email-campaign-2", type: "email.delivered" };
  await Promise.all([recordCampaignDelivery(event), recordCampaignDelivery(event)]);
  assert.equal((await readCampaignStats(draft.id)).delivered, 1);

  const future = await saveCampaign(content);
  const futureQueued = await changeCampaign(future.id, future.revision, "queue", new Date(Date.now() + 3600_000).toISOString());
  assert.equal((await processCampaign(futureQueued.id)).processed, 0);
  const cancelled = await changeCampaign(futureQueued.id, futureQueued.revision, "cancel", null);
  assert.equal(cancelled.state, "cancelled");
  assert.equal(sent.length, 2);

  console.log("Campaign integration passed with isolated Redis and simulated Clerk/Resend.");
} finally {
  globalThis.fetch = oldFetch;
}
