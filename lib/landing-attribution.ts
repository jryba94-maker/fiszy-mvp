export type LandingAttribution = {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  referrerHost: string | null;
};

const STORAGE_KEY = "fiszy_landing_attribution_v1";

function clean(value: string | null) {
  return value?.trim().slice(0, 160) || null;
}

function fromLocation(): LandingAttribution {
  const params = new URLSearchParams(window.location.search);
  let referrerHost: string | null = null;
  try { referrerHost = document.referrer ? new URL(document.referrer).hostname.slice(0, 160) : null; }
  catch { referrerHost = null; }
  return {
    utmSource: clean(params.get("utm_source")),
    utmMedium: clean(params.get("utm_medium")),
    utmCampaign: clean(params.get("utm_campaign")),
    utmContent: clean(params.get("utm_content")),
    utmTerm: clean(params.get("utm_term")),
    referrerHost,
  };
}

function valid(value: unknown): value is LandingAttribution {
  if (!value || typeof value !== "object") return false;
  return ["utmSource", "utmMedium", "utmCampaign", "utmContent", "utmTerm", "referrerHost"]
    .every((key) => {
      const item = (value as Record<string, unknown>)[key];
      return item === null || typeof item === "string";
    });
}

/** Captures first-touch campaign data for the current browser session. */
export function landingAttribution(): LandingAttribution {
  const current = fromLocation();
  const hasCampaign = Boolean(current.utmSource || current.utmMedium || current.utmCampaign || current.utmContent || current.utmTerm);
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null");
    if (hasCampaign) {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(current));
      return current;
    }
    if (valid(saved)) return saved;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Tracking must never affect navigation or signup.
  }
  return current;
}

export function landingSourceLabel(source: LandingAttribution) {
  return [source.utmSource, source.utmMedium, source.utmCampaign].filter(Boolean).join("/") || source.referrerHost || "direct";
}
