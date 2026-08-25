import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyResendWebhook(input: {
  payload: string;
  id: string;
  timestamp: string;
  signature: string;
  secret: string;
  now?: number;
}) {
  if (!/^msg_[A-Za-z0-9]+$/.test(input.id) || !/^\d{10}$/.test(input.timestamp) || !input.secret.startsWith("whsec_")) return false;
  const timestampMs = Number(input.timestamp) * 1000;
  if (!Number.isFinite(timestampMs) || Math.abs((input.now ?? Date.now()) - timestampMs) > 5 * 60_000) return false;
  let secret: Buffer;
  try { secret = Buffer.from(input.secret.slice(6), "base64"); } catch { return false; }
  if (secret.length < 16) return false;
  const expected = createHmac("sha256", secret).update(`${input.id}.${input.timestamp}.${input.payload}`).digest("base64");
  return input.signature.split(" ").some((candidate) => {
    const value = candidate.startsWith("v1,") ? candidate.slice(3) : "";
    const left = Buffer.from(value);
    const right = Buffer.from(expected);
    return left.length === right.length && timingSafeEqual(left, right);
  });
}
