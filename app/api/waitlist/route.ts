import { NextRequest, NextResponse } from "next/server";
import { errorDetails, logEvent } from "../../../lib/observability";
import { hasSameOrigin } from "../../../lib/request-origin";
import { sendWaitlistConfirmation } from "../../../lib/transactional-email";
import {
  consumeWaitlistRateLimit,
  normalizeWaitlistSignup,
  saveWaitlistSignup,
} from "../../../lib/waitlist-storage";

export const dynamic = "force-dynamic";

function clientAddress(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown";
}

export async function POST(request: NextRequest) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ outcome: "invalid_origin" }, { status: 403 });
  }
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(contentLength) || contentLength > 4096) {
    return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
  }

  try {
    const limit = await consumeWaitlistRateLimit(clientAddress(request));
    if (!limit.allowed) {
      logEvent("waitlist.signup.rate_limited", {}, "warning");
      return NextResponse.json(
        { outcome: "rate_limited" },
        { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
      );
    }
  } catch (error) {
    logEvent("waitlist.signup.rate_limit_failed", errorDetails(error), "error");
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
  }

  const input = normalizeWaitlistSignup(body);
  if (!input) {
    return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
  }

  try {
    const result = await saveWaitlistSignup(input);
    logEvent("waitlist.signup.accepted", {
      created: result.created,
      source: input.source.utmSource ?? "direct",
      medium: input.source.utmMedium ?? null,
      campaign: input.source.utmCampaign ?? null,
    });
    if (result.created) {
      try {
        await sendWaitlistConfirmation(input.email);
        logEvent("waitlist.confirmation.sent", {});
      } catch (error) {
        logEvent("waitlist.confirmation.failed", errorDetails(error), "error");
      }
    }
    return NextResponse.json(
      { outcome: "accepted" },
      {
        status: result.created ? 201 : 200,
        headers: { "Cache-Control": "private, no-store, max-age=0" },
      },
    );
  } catch (error) {
    logEvent("waitlist.signup.failed", errorDetails(error), "error");
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}
