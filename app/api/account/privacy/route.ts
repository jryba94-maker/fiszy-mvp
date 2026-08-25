import { NextRequest, NextResponse } from "next/server";
import { currentAccountIdentity } from "../../../../lib/account-auth";
import { consumeAccountRateLimit } from "../../../../lib/portal-storage";
import { createPrivacyRequest, listAccountPrivacyRequests, PRIVACY_PURPOSES, PRIVACY_REQUEST_KINDS, readPrivacyConsents, recordPrivacyConsent, type PrivacyPurpose, type PrivacyRequestKind } from "../../../../lib/privacy-storage";
import { hasSameOrigin } from "../../../../lib/request-origin";

export const dynamic = "force-dynamic";

export async function GET() {
  const identity = await currentAccountIdentity();
  if (!identity) return NextResponse.json({ outcome: "unauthorized" }, { status: 401 });
  try {
    const [consents, requests] = await Promise.all([
      readPrivacyConsents(identity.accountId),
      listAccountPrivacyRequests({ accountId: identity.accountId, limit: 30 }),
    ]);
    return NextResponse.json({ outcome: "ok", consents, requests: requests?.requests ?? [] }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Unable to read privacy center.", error);
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const identity = await currentAccountIdentity();
  if (!identity) return NextResponse.json({ outcome: "unauthorized" }, { status: 401 });
  if (!hasSameOrigin(request)) return NextResponse.json({ outcome: "invalid_origin" }, { status: 403 });
  try {
    if (!(await consumeAccountRateLimit({ accountId: identity.accountId, action: "profile", limit: 20, windowSeconds: 600 }))) return NextResponse.json({ outcome: "rate_limited" }, { status: 429 });
    const body = await request.json() as Record<string, unknown>;
    if (body.action === "consent" && PRIVACY_PURPOSES.includes(body.purpose as PrivacyPurpose) && typeof body.granted === "boolean") {
      const event = await recordPrivacyConsent({ accountId: identity.accountId, purpose: body.purpose as PrivacyPurpose, granted: body.granted });
      return NextResponse.json({ outcome: "recorded", consent: event }, { status: 201 });
    }
    if (body.action === "request" && PRIVACY_REQUEST_KINDS.includes(body.kind as PrivacyRequestKind) && (body.note === undefined || body.note === null || typeof body.note === "string")) {
      const privacyRequest = await createPrivacyRequest({ accountId: identity.accountId, kind: body.kind as PrivacyRequestKind, note: body.note as string | null | undefined });
      return NextResponse.json({ outcome: "created", request: privacyRequest }, { status: 201 });
    }
    return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
  } catch (error) {
    console.error("Unable to update privacy center.", error);
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}
