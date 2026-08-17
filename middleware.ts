import { clerkMiddleware } from "@clerk/nextjs/server";

// Publiczny katalog pozostaje otwarty. Prywatne API konta i każda akcja
// aukcyjna weryfikują użytkownika po stronie serwera. Panel administracyjny
// zachowuje oddzielną, ograniczaną rolami sesję operacyjną.
export default clerkMiddleware();

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
