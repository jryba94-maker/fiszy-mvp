import type { MetadataRoute } from "next";
import { listPublicAuctions } from "../lib/auction-view";
import { absoluteSiteUrl } from "../lib/site";

export const revalidate = 900;

const STATIC_PATHS = [
  "/",
  "/aukcje",
  "/jak-to-dziala",
  "/aukcja-holenderska",
  "/aukcja-holenderska-a-zwykla-licytacja",
  "/cena-spada-w-aukcji-holenderskiej",
  "/czy-aukcja-holenderska-jest-uczciwa",
  "/jak-kupowac-na-aukcji-holenderskiej",
  "/o-fiszy",
  "/faq",
  "/zasady-aukcji",
  "/regulamin",
  "/prywatnosc",
  "/cookies",
  "/reklamacje",
] as const;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = STATIC_PATHS.map((pathname) => ({
    url: absoluteSiteUrl(pathname),
    changeFrequency:
      pathname === "/" || pathname === "/aukcje"
        ? "daily"
        : pathname === "/jak-to-dziala" || pathname === "/aukcja-holenderska" || pathname === "/aukcja-holenderska-a-zwykla-licytacja" || pathname === "/cena-spada-w-aukcji-holenderskiej" || pathname === "/czy-aukcja-holenderska-jest-uczciwa" || pathname === "/jak-kupowac-na-aukcji-holenderskiej" || pathname === "/o-fiszy"
          ? "weekly"
          : "monthly",
    priority:
      pathname === "/"
        ? 1
        : pathname === "/aukcje" || pathname === "/jak-to-dziala" || pathname === "/aukcja-holenderska" || pathname === "/aukcja-holenderska-a-zwykla-licytacja" || pathname === "/cena-spada-w-aukcji-holenderskiej" || pathname === "/czy-aukcja-holenderska-jest-uczciwa" || pathname === "/jak-kupowac-na-aukcji-holenderskiej"
          ? 0.9
          : pathname === "/o-fiszy"
            ? 0.8
            : 0.5,
  }));

  try {
    let cursor: string | null = null;
    for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
      const page = await listPublicAuctions({ cursor, limit: 50 });
      if (!page) break;
      entries.push(...page.auctions.map((auction) => ({
        url: absoluteSiteUrl(`/aukcje/${encodeURIComponent(auction.auctionId)}`),
        changeFrequency: "always" as const,
        priority: auction.status === "live" ? 0.9 : 0.7,
      })));
      cursor = page.nextCursor;
      if (!cursor) break;
    }
  } catch {
    // The static portal remains discoverable during a temporary storage outage.
  }

  return entries;
}
