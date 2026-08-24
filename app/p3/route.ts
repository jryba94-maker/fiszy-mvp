import { NextRequest, NextResponse } from "next/server";

export function GET(request: NextRequest) {
  const destination = new URL("/", request.url);
  destination.searchParams.set("utm_source", "instagram");
  destination.searchParams.set("utm_medium", "social");
  destination.searchParams.set("utm_campaign", "post_3");
  return NextResponse.redirect(destination, 307);
}
