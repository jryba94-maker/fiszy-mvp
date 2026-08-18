import { NextRequest, NextResponse } from "next/server";
import { currentAccountIdentity } from "../../../../lib/account-auth";
import {
  consumeAccountRateLimit,
  listReadAccountNotificationIds,
  markAccountNotificationsRead,
  normalizeNotificationIds,
} from "../../../../lib/portal-storage";
import { hasSameOrigin } from "../../../../lib/request-origin";

export const dynamic = "force-dynamic";

export async function GET() {
  const identity = await currentAccountIdentity();
  if (!identity) return NextResponse.json({ outcome: "unauthorized" }, { status: 401 });
  try {
    const readIds = await listReadAccountNotificationIds(identity.accountId);
    return NextResponse.json(
      { outcome: "ok", readIds },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  } catch (error) {
    console.error("Unable to read account notification state.", error);
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}

export async function PATCH(request: NextRequest) {
  const identity = await currentAccountIdentity();
  if (!identity) return NextResponse.json({ outcome: "unauthorized" }, { status: 401 });
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ outcome: "invalid_origin" }, { status: 403 });
  }
  try {
    if (!(await consumeAccountRateLimit({ accountId: identity.accountId, action: "notifications", limit: 30, windowSeconds: 600 }))) {
      return NextResponse.json({ outcome: "rate_limited" }, { status: 429, headers: { "Retry-After": "600" } });
    }
  } catch {
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
  }
  const candidate = body && typeof body === "object" ? body as Record<string, unknown> : null;
  const notificationIds = normalizeNotificationIds(candidate?.notificationIds);
  if (!notificationIds) return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
  try {
    const readIds = await markAccountNotificationsRead({ accountId: identity.accountId, notificationIds });
    return NextResponse.json({ outcome: "ok", readIds });
  } catch (error) {
    console.error("Unable to update account notification state.", error);
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}
