import { NextRequest, NextResponse } from "next/server";
import { currentAccountIdentity } from "../../../../../lib/account-auth";
import { readAutopayIntent } from "../../../../../lib/autopay-storage";
import { absoluteSiteUrl } from "../../../../../lib/site";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  // A browser return is navigation only. Even a signed return must never grant
  // entry or settle an order: the binding business event is the signed ITN.
  const identity = await currentAccountIdentity();
  const orderId = request.nextUrl.searchParams.get("OrderID") ?? "";
  if (!identity || !/^[a-f0-9]{32}$/.test(orderId)) return NextResponse.redirect(absoluteSiteUrl("/moje-fiszy"));
  const intent = await readAutopayIntent(`ap_${orderId}`);
  if (!intent || intent.bidderId !== `clerk:${identity.accountId}`) return NextResponse.redirect(absoluteSiteUrl("/moje-fiszy"));
  const path = intent.kind === "post_auction_purchase" ? "/moje-fiszy" : `/aukcje/${encodeURIComponent(intent.auctionId)}?${intent.kind === "auction_entry" ? "payment" : "purchase"}=success`;
  return NextResponse.redirect(absoluteSiteUrl(path));
}
