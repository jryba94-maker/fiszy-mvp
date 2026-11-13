"use client";

import { useEffect, useRef } from "react";
import { landingSessionId, landingVisitorId } from "../../../lib/browser-traffic";
import { landingAttribution, landingSourceLabel } from "../../../lib/landing-attribution";

export function PublicPageView({ page }: { page: "landing" | "auction" }) {
  const viewId = useRef<string | null>(null);
  useEffect(() => {
    viewId.current ??= crypto.randomUUID();
    const body = JSON.stringify({
      type: "view",
      page,
      viewId: viewId.current,
      sessionId: landingSessionId(),
      visitorId: landingVisitorId(),
      source: landingSourceLabel(landingAttribution()),
    });
    void fetch("/api/analytics/landing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => undefined);
  }, [page]);
  return null;
}
