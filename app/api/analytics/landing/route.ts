import { NextRequest, NextResponse } from "next/server";
import { type LandingEvent, LANDING_EVENTS, landingSource, recordLandingDuration, recordLandingEvent, recordLandingView, validLandingSession } from "../../../../lib/landing-traffic";
import { hasSameOrigin } from "../../../../lib/request-origin";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!hasSameOrigin(request)) return NextResponse.json({ outcome: "invalid_origin" }, { status: 403 });
  if (Number(request.headers.get("content-length") ?? 0) > 2048) return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
  try {
    const body = await request.json() as { type?: unknown; sessionId?: unknown; viewId?: unknown; visitorId?: unknown; source?: unknown; event?: unknown; seconds?: unknown };
    if (!validLandingSession(body.sessionId)) return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
    const input = { sessionId: body.sessionId, source: landingSource(body.source) };
    if (body.type === "view") await recordLandingView({ ...input, viewId: body.viewId, visitorId: body.visitorId });
    else if (body.type === "duration" && typeof body.seconds === "number") await recordLandingDuration({ ...input, seconds: body.seconds });
    else if (body.type === "event" && typeof body.event === "string" && (LANDING_EVENTS as readonly string[]).includes(body.event)) await recordLandingEvent({ ...input, event: body.event as LandingEvent });
    else return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
    return new NextResponse(null, { status: 204 });
  } catch { return NextResponse.json({ outcome: "storage_error" }, { status: 503 }); }
}
