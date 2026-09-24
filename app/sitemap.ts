import type { MetadataRoute } from "next";
import { listPublicAuctions } from "../lib/auction-view";
import { absoluteSiteUrl } from "../lib/site";

export const revalidate = 900;

const STATIC_PATHS = [
  "/",
  "/aukcje",
  "/jak-to-dziala",
  "/o-fiszy",
  "/faq",
  "/zasady-aukcji",
  "/regulamin",
  "/prywatnosc",
  "/cookies",
  "/reklamacje",
] as const;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const entries: MetadataRoute.Sitemap = STATIC_PATHS.map((pathname) => ({
    url: absoluteSiteUrl(pathname),
    lastModified: now,
    changeFrequency:
      pathname === "/" || pathname === "/aukcje"
        ? "daily"
        : pathname === "/jak-to-dziala" || pathname === "/o-fiszy"
          ? "weekly"
          : "monthly",
    priority:
      pathname === "/"
        ? 1
        : pathname === "/aukcje" || pathname === "/jak-to-dziala"
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
        lastModified: now,
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
