const FALLBACK_SITE_URL = "https://fiszy-mvp.vercel.app";

function normalizedSiteUrl(value: string | undefined) {
  if (!value?.trim()) return null;
  const candidate = value.trim().replace(/\/$/, "");
  try {
    const url = new URL(candidate.startsWith("http") ? candidate : `https://${candidate}`);
    if (url.protocol !== "https:" && url.hostname !== "localhost") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function siteUrl() {
  return normalizedSiteUrl(process.env.NEXT_PUBLIC_SITE_URL) ??
    normalizedSiteUrl(process.env.VERCEL_PROJECT_PRODUCTION_URL) ??
    FALLBACK_SITE_URL;
}

export function absoluteSiteUrl(pathname = "/") {
  return new URL(pathname, `${siteUrl()}/`).toString();
}
