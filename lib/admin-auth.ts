import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

export const ADMIN_SESSION_COOKIE = "fiszy_admin_session";
export const ADMIN_SESSION_SECONDS = 8 * 60 * 60;

const SESSION_MARKER = "fiszy-admin-session-v1";

function configuredSecret() {
  return process.env.FISZY_ADMIN_SECRET?.trim() || null;
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function sessionSignature(secret: string, expiresAt: string, nonce: string) {
  return createHmac("sha256", secret)
    .update(`${SESSION_MARKER}:${expiresAt}:${nonce}`)
    .digest("base64url");
}

export function adminSessionToken(secret: string) {
  const expiresAt = String(
    Math.floor(Date.now() / 1000) + ADMIN_SESSION_SECONDS,
  );
  const nonce = randomBytes(18).toString("base64url");
  return `${expiresAt}.${nonce}.${sessionSignature(secret, expiresAt, nonce)}`;
}

function isValidAdminSessionToken(token: string, secret: string) {
  const [expiresAt, nonce, signature, extra] = token.split(".");
  if (
    extra ||
    !/^\d{10}$/.test(expiresAt ?? "") ||
    !/^[A-Za-z0-9_-]{20,40}$/.test(nonce ?? "") ||
    !signature
  ) {
    return false;
  }

  const expiresAtSeconds = Number(expiresAt);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (
    !Number.isSafeInteger(expiresAtSeconds) ||
    expiresAtSeconds <= nowSeconds ||
    expiresAtSeconds > nowSeconds + ADMIN_SESSION_SECONDS + 60
  ) {
    return false;
  }

  return safeEqual(
    signature,
    sessionSignature(secret, expiresAt, nonce),
  );
}

export function isAdminConfigured() {
  return Boolean(configuredSecret());
}

export function isAdminSecretStrong() {
  const secret = configuredSecret();
  return Boolean(
    secret &&
      secret.length >= 32 &&
      !/^(?:change-me|admin|password|secret)/i.test(secret),
  );
}

export function isValidAdminSecret(candidate: string | null | undefined) {
  const secret = configuredSecret();
  return Boolean(secret && candidate && safeEqual(candidate, secret));
}

export function hasValidAdminRequest(request: NextRequest) {
  const secret = configuredSecret();
  if (!secret) return false;

  const cookieToken = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  if (cookieToken && isValidAdminSessionToken(cookieToken, secret)) {
    return true;
  }

  const authorization = request.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  return (
    authorization.startsWith(prefix) &&
    isValidAdminSecret(authorization.slice(prefix.length))
  );
}

export function isSameOriginAdminMutation(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return true;

  try {
    return new URL(origin).origin === request.nextUrl.origin;
  } catch {
    return false;
  }
}
