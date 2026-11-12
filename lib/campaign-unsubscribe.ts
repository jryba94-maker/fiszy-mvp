import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { redisCommand } from "./redis";
import { absoluteSiteUrl } from "./site";

function signingSecret() {
  return (process.env.FISZY_CAMPAIGN_SECRET || process.env.FISZY_RATE_LIMIT_SECRET || process.env.FISZY_ADMIN_SECRET)?.trim() ?? "";
}

export function campaignUnsubscribeConfigured() {
  return signingSecret().length >= 32;
}

export function campaignEmailFingerprint(email: string) {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

function signature(fingerprint: string) {
  const secret = signingSecret();
  if (secret.length < 32) return null;
  return createHmac("sha256", secret).update(`fiszy-marketing-unsubscribe-v1:${process.env.VERCEL_ENV ?? "local"}:${fingerprint}`).digest("hex");
}

export function campaignUnsubscribeUrl(fingerprint: string) {
  const digest = signature(fingerprint);
  if (!digest || !/^[a-f0-9]{64}$/.test(fingerprint)) throw new Error("Campaign unsubscribe is not configured.");
  return absoluteSiteUrl(`/api/marketing/unsubscribe?token=${fingerprint}.${digest}`);
}

export function verifyCampaignUnsubscribe(token: string) {
  if (!/^[a-f0-9]{64}\.[a-f0-9]{64}$/.test(token)) return null;
  const [fingerprint, received] = token.split(".");
  const expected = signature(fingerprint);
  return expected && timingSafeEqual(Buffer.from(received, "hex"), Buffer.from(expected, "hex")) ? fingerprint : null;
}

function suppressionKey(fingerprint: string) {
  return `fiszy:${process.env.VERCEL_ENV ?? "local"}:marketing:suppressed:${fingerprint}`;
}

export async function suppressCampaignEmail(token: string) {
  const fingerprint = verifyCampaignUnsubscribe(token);
  if (!fingerprint) return false;
  return await redisCommand<string>(["SET", suppressionKey(fingerprint), new Date().toISOString()]) === "OK";
}

export async function isCampaignEmailSuppressed(fingerprint: string) {
  return Boolean(await redisCommand<string>(["GET", suppressionKey(fingerprint)]));
}
