import { NextResponse } from "next/server";
import { normalizeAuctionId } from "../../../../../lib/auction";
import { readPublicAuction } from "../../../../../lib/auction-view";

export const dynamic = "force-dynamic";

function icsText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function icsDate(value: string) {
  return new Date(value).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export async function GET(
  request: Request,
  context: { params: Promise<{ auctionId: string }> },
) {
  const { auctionId: rawAuctionId } = await context.params;
  const auctionId = normalizeAuctionId(rawAuctionId);
  if (!auctionId) return NextResponse.json({ outcome: "invalid_request" }, { status: 400 });
  try {
    const auction = await readPublicAuction(auctionId);
    if (!auction) return NextResponse.json({ outcome: "not_found" }, { status: 404 });
    const origin = new URL(request.url).origin;
    const body = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Fiszy//Aukcje//PL",
      "CALSCALE:GREGORIAN",
      "BEGIN:VEVENT",
      `UID:${icsText(`${auction.runId}@fiszy`)}`,
      `DTSTAMP:${icsDate(new Date().toISOString())}`,
      `DTSTART:${icsDate(auction.startsAt)}`,
      `DTEND:${icsDate(auction.endsAt)}`,
      `SUMMARY:${icsText(`Fiszy: ${auction.product}`)}`,
      `DESCRIPTION:${icsText("Aukcja z malejącą ceną. Zaloguj się wcześniej i sprawdź zasady.")}`,
      `URL:${origin}/aukcje/${encodeURIComponent(auction.auctionId)}`,
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join("\r\n");
    return new NextResponse(body, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="fiszy-${auction.auctionId}.ics"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Unable to create auction calendar entry.", error);
    return NextResponse.json({ outcome: "storage_error" }, { status: 503 });
  }
}
