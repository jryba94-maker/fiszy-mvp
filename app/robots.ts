import type { MetadataRoute } from "next";
import { absoluteSiteUrl, siteUrl } from "../lib/site";

export default function robots(): MetadataRoute.Robots {
  const isProduction = process.env.VERCEL_ENV === "production";
  return {
    rules: isProduction
      ? { userAgent: "*", allow: "/", disallow: ["/admin", "/api", "/moje-fiszy"] }
      : { userAgent: "*", disallow: "/" },
    ...(isProduction
      ? { sitemap: absoluteSiteUrl("/sitemap.xml"), host: siteUrl() }
      : {}),
  };
}
