import { NextRequest, NextResponse } from "next/server";
import { hasSameOrigin } from "../../../../lib/request-origin";
import { recordLandingDuration, recordLandingVisit, type LandingSource } from "../../../../lib/landing-traffic";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!hasSameOrigin(request)) return new NextResponse(null, { status: 403 });
  try {
    const body = await request.json() as { event?: unknown; sessionId?: unknown; durationSeconds?: unknown; source?: LandingSource };
    if (typeof body.sessionId !== "string") return new NextResponse(null, { status: 400 });
    if (body.event === "visit") await recordLandingVisit({ sessionId: body.sessionId, source: body.source ?? {} });
    else if (body.event === "duration" && typeof body.durationSeconds === "number") await recordLandingDuration({ sessionId: body.sessionId, durationSeconds: body.durationSeconds });
    else return new NextResponse(null, { status: 400 });
    return new NextResponse(null, { status: 204 });
  } catch { return new NextResponse(null, { status: 204 }); }
}
