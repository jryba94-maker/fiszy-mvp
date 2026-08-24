import { createHmac } from "node:crypto";

const LOCAL_RATE_LIMIT_SECRET = "fiszy-local-rate-limit-v2";

function rateLimitSecret() {
  const configured =
    process.env.FISZY_RATE_LIMIT_SECRET?.trim() ||
    process.env.FISZY_ADMIN_SECRET?.trim();
  if (configured) return configured;
  if (process.env.VERCEL_ENV === "production") {
    throw new Error("Production rate limiting requires a dedicated server secret.");
  }
  return LOCAL_RATE_LIMIT_SECRET;
}

export function rateLimitFingerprint(
  purpose: string,
  value: string,
  length = 32,
) {
  if (!/^[a-z0-9_.:-]{1,80}$/.test(purpose) || length < 16 || length > 64) {
    throw new Error("Invalid rate-limit fingerprint scope.");
  }
  return createHmac("sha256", rateLimitSecret())
    .update("fiszy-rate-limit-v2\0")
    .update(process.env.VERCEL_ENV ?? "local")
    .update("\0")
    .update(purpose)
    .update("\0")
    .update(value)
    .digest("hex")
    .slice(0, length);
}
