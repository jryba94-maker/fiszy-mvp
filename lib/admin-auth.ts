import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";

export const ADMIN_SESSION_COOKIE = "fiszy_admin_session";
export const ADMIN_SESSION_SECONDS = 8 * 60 * 60;

const SESSION_MARKER = "fiszy-admin-session-v1";
const PRINCIPAL_SESSION_MARKER = "fiszy-admin-principal-v2";

export type AdminRole = "owner" | "operator" | "support" | "viewer";
export type AdminPermission =
  | "auctions:write"
  | "orders:write"
  | "users:read"
  | "users:write"
  | "support:write"
  | "audit:read";

const ROLE_PERMISSIONS: Record<AdminRole, AdminPermission[]> = {
  owner: ["auctions:write", "orders:write", "users:read", "users:write", "support:write", "audit:read"],
  operator: ["auctions:write", "orders:write", "users:read", "support:write", "audit:read"],
  support: ["users:read", "support:write"],
  viewer: ["users:read", "audit:read"],
};

export type AdminPrincipal = {
  role: AdminRole;
  permissions: AdminPermission[];
  actorType: "admin_session" | "admin_api" | "admin_clerk";
  actorRef: string | null;
};

function configuredIndividualAdmins() {
  const raw = process.env.FISZY_ADMIN_USERS_JSON?.trim();
  if (!raw) return new Map<string, AdminRole>();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return new Map<string, AdminRole>();
    const entries = Object.entries(parsed).flatMap(([userId, role]) =>
      /^user_[A-Za-z0-9_-]{5,100}$/.test(userId) &&
      (role === "owner" || role === "operator" || role === "support" || role === "viewer")
        ? [[userId, role] as const]
        : [],
    );
    return entries.length === Object.keys(parsed).length
      ? new Map<string, AdminRole>(entries)
      : new Map<string, AdminRole>();
  } catch {
    return new Map<string, AdminRole>();
  }
}

export function individualAdminAccountsConfigured() {
  return configuredIndividualAdmins().size > 0;
}

export function configuredAdminRole(): AdminRole {
  const value = process.env.FISZY_ADMIN_ROLE?.trim().toLowerCase();
  return value === "operator" || value === "support" || value === "viewer" ? value : "owner";
}

export function adminPermissions(role: AdminRole = configuredAdminRole()) {
  return [...ROLE_PERMISSIONS[role]];
}

function configuredSecret() {
  return process.env.FISZY_ADMIN_SECRET?.trim() || null;
}

function principalSigningSecret() {
  return configuredSecret() ?? process.env.CLERK_SECRET_KEY?.trim() ?? null;
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

function principalSessionSignature(secret: string, expiresAt: string, role: AdminRole, actorRef: string, nonce: string) {
  return createHmac("sha256", secret)
    .update(`${PRINCIPAL_SESSION_MARKER}:${expiresAt}:${role}:${actorRef}:${nonce}`)
    .digest("base64url");
}

export function adminPrincipalSessionToken(principal: AdminPrincipal) {
  const secret = principalSigningSecret();
  if (!secret || principal.actorType !== "admin_clerk" || !principal.actorRef) throw new Error("Unable to sign admin principal session.");
  const expiresAt = String(Math.floor(Date.now() / 1000) + ADMIN_SESSION_SECONDS);
  const nonce = randomBytes(18).toString("base64url");
  return `v2.${expiresAt}.${principal.role}.${principal.actorRef}.${nonce}.${principalSessionSignature(secret, expiresAt, principal.role, principal.actorRef, nonce)}`;
}

function verifiedCookiePrincipal(token: string | undefined): AdminPrincipal | null {
  if (!token) return null;
  if (!token.startsWith("v2.")) {
    const secret = configuredSecret();
    if (!secret || !isValidAdminSessionToken(token, secret)) return null;
    const role = configuredAdminRole();
    return { role, permissions: [...ROLE_PERMISSIONS[role]], actorType: "admin_session", actorRef: null };
  }
  const [version, expiresAt, roleValue, actorRef, nonce, signature, extra] = token.split(".");
  const secret = principalSigningSecret();
  const role = roleValue as AdminRole;
  const now = Math.floor(Date.now() / 1000);
  if (
    extra || version !== "v2" || !secret || !/^\d{10}$/.test(expiresAt ?? "") ||
    !Object.hasOwn(ROLE_PERMISSIONS, role) || !/^[a-f0-9]{20}$/.test(actorRef ?? "") ||
    !/^[A-Za-z0-9_-]{20,40}$/.test(nonce ?? "") || !signature ||
    Number(expiresAt) <= now || Number(expiresAt) > now + ADMIN_SESSION_SECONDS + 60 ||
    !safeEqual(signature, principalSessionSignature(secret, expiresAt, role, actorRef, nonce))
  ) return null;
  return { role, permissions: [...ROLE_PERMISSIONS[role]], actorType: "admin_clerk", actorRef };
}

function verifiedSynchronousPrincipal(request: NextRequest): AdminPrincipal | null {
  const cookie = verifiedCookiePrincipal(request.cookies.get(ADMIN_SESSION_COOKIE)?.value);
  if (cookie) return cookie;
  const authorization = request.headers.get("authorization") ?? "";
  if (authorization.startsWith("Bearer ") && isValidAdminSecret(authorization.slice(7))) {
    const role = configuredAdminRole();
    return { role, permissions: [...ROLE_PERMISSIONS[role]], actorType: "admin_api", actorRef: null };
  }
  return null;
}

export function isAdminConfigured() {
  return Boolean(configuredSecret()) || Boolean(
    individualAdminAccountsConfigured() && process.env.CLERK_SECRET_KEY?.trim(),
  );
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
  return verifiedSynchronousPrincipal(request) !== null;
}

export function hasAdminPermission(request: NextRequest, permission: AdminPermission) {
  return Boolean(verifiedSynchronousPrincipal(request)?.permissions.includes(permission));
}

export async function resolveAdminPrincipal(request: NextRequest): Promise<AdminPrincipal | null> {
  const synchronous = verifiedSynchronousPrincipal(request);
  if (synchronous) return synchronous;
  const admins = configuredIndividualAdmins();
  const signingSecret = principalSigningSecret();
  if (!admins.size || !signingSecret) return null;
  try {
    const { userId } = await auth();
    const role = userId ? admins.get(userId) : null;
    if (!userId || !role) return null;
    const actorRef = createHmac("sha256", signingSecret)
      .update(userId)
      .digest("hex")
      .slice(0, 20);
    return { role, permissions: [...ROLE_PERMISSIONS[role]], actorType: "admin_clerk", actorRef };
  } catch {
    return null;
  }
}

export async function hasValidAdminRequestAsync(request: NextRequest) {
  return Boolean(await resolveAdminPrincipal(request));
}

export async function hasAdminPermissionAsync(request: NextRequest, permission: AdminPermission) {
  const principal = await resolveAdminPrincipal(request);
  return Boolean(principal?.permissions.includes(permission));
}

export function verifiedAdminActorType(
  request: NextRequest,
): "admin_session" | "admin_api" | "admin_clerk" | null {
  return verifiedSynchronousPrincipal(request)?.actorType ?? null;
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
