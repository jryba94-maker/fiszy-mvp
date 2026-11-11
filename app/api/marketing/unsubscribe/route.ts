import { NextRequest, NextResponse } from "next/server";
import { suppressCampaignEmail, verifyCampaignUnsubscribe } from "../../../../lib/campaign-unsubscribe";

export const dynamic = "force-dynamic";

function page(message: string, token?: string, status = 200) {
  return new NextResponse(`<!doctype html><html lang="pl"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Wiadomości marketingowe Fiszy</title><body><main style="font:18px system-ui;max-width:36rem;margin:4rem auto;padding:1rem"><h1>Wiadomości marketingowe Fiszy</h1><p>${message}</p>${token ? `<form method="post" action="?token=${token}"><button type="submit">Wypisz mnie</button></form>` : ""}</main></body></html>`, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}

export function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  return verifyCampaignUnsubscribe(token)
    ? page("Potwierdź rezygnację z wiadomości marketingowych.", token)
    : page("Ten link jest nieprawidłowy.", undefined, 400);
}

export async function POST(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  if (!verifyCampaignUnsubscribe(token)) return page("Ten link jest nieprawidłowy.", undefined, 400);
  try {
    if (!await suppressCampaignEmail(token)) throw new Error("Unable to save marketing unsubscribe.");
    return page("Adres został wypisany z wiadomości marketingowych Fiszy.");
  } catch {
    return page("Nie udało się zapisać rezygnacji. Spróbuj ponownie.", token, 503);
  }
}
