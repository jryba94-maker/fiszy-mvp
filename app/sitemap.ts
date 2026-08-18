import type { MetadataRoute } from "next";
import { listPublicAuctions } from "../lib/auction-view";
import { absoluteSiteUrl } from "../lib/site";

export const revalidate = 900;

const STATIC_PATHS = [
  "/",
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
    changeFrequency: pathname === "/" ? "hourly" : "monthly",
    priority: pathname === "/" ? 1 : 0.5,
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
