import { NextRequest, NextResponse } from "next/server";
import { currentAccountIdentity } from "../../../../lib/account-auth";
import {
  consumeAccountRateLimit,
  ensureAccountProfile,
  normalizeAccountProfilePatch,
  requestAccountDeletion,
  updateAccountProfile,
} from "../../../../lib/portal-storage";
import { hasSameOrigin } from "../../../../lib/request-origin";
import { createPrivacyRequest, listAccountPrivacyRequests, recordPrivacyConsent } from "../../../../lib/privacy-storage";

export const dynamic = "force-dynamic";

export async function GET() {
  const identity = await currentAccountIdentity();
  if (!identity) return NextResponse.json({ outcome: "unauthorized" }, { status: 401 });
  try {
    const profile = await ensureAccountProfile(identity.accountId);
    return NextResponse.json(
      { outcome: "ok", profile },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  } catch (error) {
    console.error("Unable to read account profile.", error);
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}

export async function PATCH(request: NextRequest) {
  const identity = await currentAccountIdentity();
  if (!identity) return NextResponse.json({ outcome: "unauthorized" }, { status: 401 });
  if (!hasSameOrigin(request)) return NextResponse.json({ outcome: "invalid_origin" }, { status: 403 });
  try {
    if (!(await consumeAccountRateLimit({ accountId: identity.accountId, action: "profile", limit: 20, windowSeconds: 600 }))) {
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
  const root = body && typeof body === "object" ? body as Record<string, unknown> : null;
  const expectedRevision = root?.expectedRevision;
  const patch = normalizeAccountProfilePatch(root?.profile);
  if (!Number.isInteger(expectedRevision) || Number(expectedRevision) < 1 || !patch) {
    return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
  }
  try {
    const previous = await ensureAccountProfile(identity.accountId);
    if (previous.revision !== Number(expectedRevision)) {
      return NextResponse.json({ outcome: "revision_conflict" }, { status: 409 });
    }
    for (const purpose of ["marketing", "analytics"] as const) {
      if (previous.preferences[purpose] !== patch.preferences[purpose]) {
        await recordPrivacyConsent({
          accountId: identity.accountId,
          purpose,
          granted: patch.preferences[purpose],
        });
      }
    }
    const profile = await updateAccountProfile({
      accountId: identity.accountId,
      expectedRevision: Number(expectedRevision),
      patch,
    });
    if (!profile) return NextResponse.json({ outcome: "revision_conflict" }, { status: 409 });
    return NextResponse.json({ outcome: "ok", profile });
  } catch (error) {
    console.error("Unable to update account profile.", error);
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}

export async function DELETE(request: NextRequest) {
  const identity = await currentAccountIdentity();
  if (!identity) return NextResponse.json({ outcome: "unauthorized" }, { status: 401 });
  if (!hasSameOrigin(request)) return NextResponse.json({ outcome: "invalid_origin" }, { status: 403 });
  try {
    if (!(await consumeAccountRateLimit({ accountId: identity.accountId, action: "profile", limit: 20, windowSeconds: 600 }))) {
      return NextResponse.json({ outcome: "rate_limited" }, { status: 429, headers: { "Retry-After": "600" } });
    }
  } catch {
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
  try {
    const profile = await requestAccountDeletion(identity.accountId);
    const existing = await listAccountPrivacyRequests({ accountId: identity.accountId, limit: 20 });
    const active = existing?.requests.find((item) => item.kind === "erasure" && item.status !== "completed" && item.status !== "rejected") ?? null;
    const privacyRequest = active ?? await createPrivacyRequest({ accountId: identity.accountId, kind: "erasure" });
    return NextResponse.json({ outcome: "deletion_requested", profile, privacyRequest });
  } catch (error) {
    console.error("Unable to request account deletion.", error);
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}
