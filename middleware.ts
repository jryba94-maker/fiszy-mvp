import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";

const CANONICAL_HOST = "fiszy.pl";
const REDIRECT_HOSTS = new Set(["fiszy.com", "www.fiszy.com"]);

// Fiszy.com remains a permanent alternate address. The 308 response preserves
// the exact path and query string, e.g. fiszy.com/demo?utm_source=instagram
// redirects to fiszy.pl/demo?utm_source=instagram.
export default clerkMiddleware((_auth, request: NextRequest) => {
  const host = request.headers.get("host")?.split(":")[0].toLowerCase();
  if (host && REDIRECT_HOSTS.has(host)) {
    const destination = request.nextUrl.clone();
    destination.protocol = "https:";
    destination.host = CANONICAL_HOST;
    return NextResponse.redirect(destination, 308);
  }
  return NextResponse.next();
});

// Publiczny katalog pozostaje otwarty. Prywatne API konta i każda akcja
// aukcyjna weryfikują użytkownika po stronie serwera. Panel administracyjny
// zachowuje oddzielną, ograniczaną rolami sesję operacyjną.
export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
