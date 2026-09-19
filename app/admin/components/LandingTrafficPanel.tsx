"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "../AdminDashboard.module.css";

type Traffic = { days: number; totals: { visits: number; uniqueSessions: number; durationSessions: number; totalDurationSeconds: number; averageDurationSeconds: number }; sources: Array<{ label: string; visits: number }> };
type Props = { onSessionExpired: () => void };
function duration(seconds: number) { return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`; }

export function LandingTrafficPanel({ onSessionExpired }: Props) {
  const [traffic, setTraffic] = useState<Traffic | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/admin/traffic?days=30", { credentials: "same-origin", cache: "no-store" });
      if (response.status === 401) return onSessionExpired();
      const payload = await response.json() as { traffic?: Traffic };
      if (!response.ok || !payload.traffic) throw new Error("traffic_unavailable");
      setTraffic(payload.traffic);
    } catch { setError("Nie udało się pobrać ruchu z landing page."); }
    finally { setLoading(false); }
  }, [onSessionExpired]);
  useEffect(() => { void load(); }, [load]);
  return <section className={styles.panelSection} aria-labelledby="traffic-heading" aria-busy={loading}>
    <div className={styles.sectionHeader}><div><p className={styles.eyebrow}>Landing page · ostatnie 30 dni</p><h2 id="traffic-heading">Ruch i zaangażowanie</h2><p className={styles.panelDescription}>Anonimowe sesje i czas, w którym strona była aktywnie oglądana. E-mail widzisz dopiero po dobrowolnym zapisie.</p></div><button type="button" className={styles.secondaryButton} onClick={() => void load()} disabled={loading}>Odśwież</button></div>
    {error ? <p className={styles.errorNotice} role="alert">{error}</p> : null}
    <div className={styles.operationsKpis} aria-label="Ruch na landing page">
      <div><strong>{traffic?.totals.visits ?? 0}</strong><span>wejścia</span></div>
      <div><strong>{traffic?.totals.uniqueSessions ?? 0}</strong><span>unikalne sesje</span></div>
      <div><strong>{duration(traffic?.totals.averageDurationSeconds ?? 0)}</strong><span>średni aktywny czas</span></div>
      <div><strong>{traffic?.totals.durationSessions ?? 0}</strong><span>sesje z czasem</span></div>
    </div>
    <div className={styles.adminSubpanel}><div className={styles.subpanelTitle}><h3>Źródła wejść</h3><span>{traffic?.sources.length ?? 0}</span></div>{traffic?.sources.length ? <div className={styles.operationsList}>{traffic.sources.map((item) => <div className={styles.compactOperation} key={item.label}><strong>{item.label}</strong><span>{item.visits} wejść</span></div>)}</div> : <p className={styles.emptyState}>{loading ? "Ładuję dane…" : "Dane zaczną się zbierać od publikacji tej wersji."}</p>}</div>
  </section>;
}
