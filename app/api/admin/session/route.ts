import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_SECONDS,
  adminPermissions,
  adminSessionToken,
  configuredAdminRole,
  hasValidAdminRequest,
  isAdminConfigured,
  isSameOriginAdminMutation,
  isValidAdminSecret,
} from "../../../../lib/admin-auth";
import { redisCommand } from "../../../../lib/redis";
import { logEvent } from "../../../../lib/observability";

export const dynamic = "force-dynamic";

const LOGIN_WINDOW_SECONDS = 15 * 60;
const MAX_LOGIN_ATTEMPTS = 10;

function loginAttemptKey(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for") ?? "unknown";
  const client = forwardedFor.split(",")[0]?.trim() || "unknown";
  const fingerprint = createHash("sha256").update(client).digest("hex").slice(0, 24);
  const environment = process.env.VERCEL_ENV ?? "local";
  return `fiszy:${environment}:admin:login-attempts:${fingerprint}`;
}

async function registerLoginAttempt(request: NextRequest) {
  const key = loginAttemptKey(request);
  const script = `
local attempts = redis.call("INCR", KEYS[1])
if attempts == 1 then redis.call("EXPIRE", KEYS[1], ARGV[1]) end
return attempts
`;
  const attempts = await redisCommand<number>([
    "EVAL",
    script,
    1,
    key,
    LOGIN_WINDOW_SECONDS,
  ]);
  return { allowed: Boolean(attempts && attempts <= MAX_LOGIN_ATTEMPTS), key };
}

function cookieOptions(request: NextRequest) {
  return {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    maxAge: ADMIN_SESSION_SECONDS,
  };
}

export async function GET(request: NextRequest) {
  return NextResponse.json(
    {
      outcome: "ok",
      configured: isAdminConfigured(),
      authenticated: hasValidAdminRequest(request),
      role: configuredAdminRole(),
      permissions: adminPermissions(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  if (!isSameOriginAdminMutation(request)) {
    return NextResponse.json({ outcome: "invalid_origin" }, { status: 403 });
  }

  if (!isAdminConfigured()) {
    return NextResponse.json(
      { outcome: "admin_not_configured" },
      { status: 503 },
    );
  }

  let loginAttempt;
  try {
    loginAttempt = await registerLoginAttempt(request);
  } catch {
    return NextResponse.json(
      { outcome: "authentication_unavailable" },
      { status: 503 },
    );
  }

  if (!loginAttempt.allowed) {
    logEvent("admin_login_rate_limited", {}, "warning");
    return NextResponse.json(
      { outcome: "too_many_attempts" },
      {
        status: 429,
        headers: { "Retry-After": String(LOGIN_WINDOW_SECONDS) },
      },
    );
  }

  let secret = "";
  try {
    const body = (await request.json()) as { secret?: unknown };
    secret = typeof body.secret === "string" ? body.secret : "";
  } catch {
    return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
  }

  if (!isValidAdminSecret(secret)) {
    logEvent("admin_login_failed", {}, "warning");
    return NextResponse.json({ outcome: "unauthorized" }, { status: 401 });
  }

  try {
    await redisCommand<number>(["DEL", loginAttempt.key]);
  } catch {
    // A successful login remains valid; the short-lived counter expires on its own.
  }

  const response = NextResponse.json({
    outcome: "authenticated",
    configured: true,
    authenticated: true,
  });
  logEvent("admin_login_succeeded");
  response.cookies.set(
    ADMIN_SESSION_COOKIE,
    adminSessionToken(secret),
    cookieOptions(request),
  );
  return response;
}

export async function DELETE(request: NextRequest) {
  if (!isSameOriginAdminMutation(request)) {
    return NextResponse.json({ outcome: "invalid_origin" }, { status: 403 });
  }

  const response = NextResponse.json({
    outcome: "signed_out",
    configured: isAdminConfigured(),
    authenticated: false,
  });
  logEvent("admin_logout_succeeded");
  response.cookies.set(ADMIN_SESSION_COOKIE, "", {
    ...cookieOptions(request),
    maxAge: 0,
  });
  return response;
}
