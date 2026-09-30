import { NextRequest, NextResponse } from "next/server";
import { type LandingEvent, LANDING_EVENTS, landingSource, recordLandingDuration, recordLandingEvent, recordLandingView, readLandingTraffic, validLandingPage, validLandingSession } from "../../../../lib/landing-traffic";
import { hasSameOrigin } from "../../../../lib/request-origin";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!hasSameOrigin(request)) return NextResponse.json({ outcome: "invalid_origin" }, { status: 403 });
  if (Number(request.headers.get("content-length") ?? 0) > 2048) return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
  try {
    const body = await request.json() as { type?: unknown; sessionId?: unknown; viewId?: unknown; visitorId?: unknown; durationId?: unknown; page?: unknown; source?: unknown; event?: unknown; seconds?: unknown };
    if (!validLandingSession(body.sessionId)) return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
    const input = { sessionId: body.sessionId, source: landingSource(body.source) };
    if (body.type === "view" && validLandingPage(body.page)) await recordLandingView({ ...input, viewId: body.viewId, visitorId: body.visitorId, page: body.page });
    else if (body.type === "duration" && typeof body.seconds === "number") await recordLandingDuration({ ...input, durationId: body.durationId, seconds: body.seconds });
    else if (body.type === "event" && typeof body.event === "string" && (LANDING_EVENTS as readonly string[]).includes(body.event)) await recordLandingEvent({ ...input, event: body.event as LandingEvent });
    else return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
    return new NextResponse(null, { status: 204 });
  } catch { return NextResponse.json({ outcome: "storage_error" }, { status: 503 }); }
}


export async function GET() {
  try {
    const traffic = await readLandingTraffic(30);
    if (!traffic) throw new Error("traffic_unavailable");
    return NextResponse.json(
      { demoOpened: traffic.totals.events.demo_opened },
      { headers: { "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300" } },
    );
  } catch {
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}
