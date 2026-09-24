"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "../AdminDashboard.module.css";

type Traffic = {
  days: number;
  daily: Array<{ date: string; views: number; uniqueSessions: number; uniqueVisitors: number }>;
  totals: { views: number; uniqueSessions: number; uniqueVisitors: number; activeSeconds: number; timedSessions: number; events: Record<string, number> };
  conversion: { formStarted: number; ctaAttempt: number; signup: number };
  averageActiveSeconds: number;
  sources: Array<{ label: string; views: number; signups: number; signupRate: number }>;
};
type Business = { totals: Record<string, number>; conversion: Record<string, number> };
type Health = { status: "ok" | "degraded"; storage: string; responseTimeMs: number; checkedAt: string };
type Props = { onSessionExpired: () => void };

const number = new Intl.NumberFormat("pl-PL");
function seconds(value: number) { return value < 60 ? `${value} s` : `${Math.floor(value / 60)} min ${value % 60}s`; }
function percent(value: number) { return `${value.toLocaleString("pl-PL", { maximumFractionDigits: 1 })}%`; }

export function LandingTrafficPanel({ onSessionExpired }: Props) {
  const [traffic, setTraffic] = useState<Traffic | null>(null);
  const [business, setBusiness] = useState<Business | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError("");
    try {
      const [trafficResult, healthResult] = await Promise.all([
        fetch("/api/admin/traffic?days=30", { credentials: "same-origin", cache: "no-store" }),
        fetch("/api/health", { cache: "no-store" }),
      ]);
      if (trafficResult.status === 401 || trafficResult.status === 403) { onSessionExpired(); return; }
      if (!trafficResult.ok) throw new Error("traffic");
      const payload = await trafficResult.json() as { traffic: Traffic; business: Business };
      setTraffic(payload.traffic); setBusiness(payload.business);
      if (healthResult.ok || healthResult.status === 503) setHealth(await healthResult.json() as Health);
      setUpdatedAt(new Date());
    } catch { setError("Nie udało się pobrać danych ruchu. Spróbuj odświeżyć panel."); }
    finally { if (!silent) setLoading(false); }
  }, [onSessionExpired]);

  useEffect(() => {
    void load();
    const refresh = window.setInterval(() => void load(true), 10_000);
    return () => window.clearInterval(refresh);
  }, [load]);

  const insight = useMemo(() => {
    if (!traffic) return "Zbieramy pierwsze dane.";
    const { uniqueSessions, events } = traffic.totals;
    if (!uniqueSessions) return "Dane zaczną się pojawiać po nowych wejściach na landing.";
    const biggestDrop = events.form_started < uniqueSessions * 0.45 ? "wejście → rozpoczęcie formularza" : events.cta_attempt < events.form_started * 0.7 ? "formularz → próba zapisu" : "próba zapisu → potwierdzony zapis";
    const source = traffic.sources[0];
    return `Największy obszar do poprawy: ${biggestDrop}.${source ? ` Najwięcej ruchu daje: ${source.label}.` : ""}`;
  }, [traffic]);

  const dailyChart = useMemo(() => {
    const days = traffic?.daily ?? [];
    const max = Math.max(1, ...days.flatMap((day) => [day.uniqueVisitors, day.views]));
    const x = (index: number) => 52 + index * (828 / Math.max(1, days.length - 1));
    const y = (value: number) => 250 - value / max * 215;
    const points = (read: (day: Traffic["daily"][number]) => number) => days.map((day, index) => `${x(index)},${y(read(day))}`).join(" ");
    const ticks = Array.from({ length: 5 }, (_, index) => Math.round(max * index / 4));
    return { days, max, x, y, points, ticks };
  }, [traffic]);

  return (
    <section className={styles.panelSection} aria-labelledby="traffic-heading" aria-busy={loading}>
      <div className={styles.sectionHeader}>
        <div><p className={styles.eyebrow}>Landing, źródła i aukcje</p><h2 id="traffic-heading">Ruch</h2></div>
        <button className={styles.secondaryButton} type="button" onClick={() => void load()} disabled={loading}>{loading ? "Odświeżam…" : "Odśwież"}</button>
      </div>
      {error ? <p className={styles.errorNotice} role="alert">{error}</p> : null}
      <p className={styles.trafficNote}>Anonimowy pomiar, ostatnie 30 dni. Dane odświeżają się co 10 sekund. Unikalnych odwiedzających rozpoznajemy po identyfikatorze zapisanym w przeglądarce od wdrożenia tej zmiany.</p>

      <div className={styles.trafficKpis}>
        <article><span>Wejścia</span><strong>{number.format(traffic?.totals.views ?? 0)}</strong><small>odsłony landing page</small></article>
        <article><span>Unikalni odwiedzający</span><strong>{number.format(traffic?.totals.uniqueVisitors ?? 0)}</strong><small>rozpoznane przeglądarki</small></article>
        <article><span>Unikalne sesje</span><strong>{number.format(traffic?.totals.uniqueSessions ?? 0)}</strong><small>osobne wizyty</small></article>
        <article><span>Aktywny czas</span><strong>{seconds(traffic?.averageActiveSeconds ?? 0)}</strong><small>średnio na stronie</small></article>
        <article><span>Zapisy</span><strong>{number.format(traffic?.totals.events.signup ?? 0)}</strong><small>{percent(traffic?.conversion.signup ?? 0)} z sesji</small></article>
      </div>

      <article className={`${styles.trafficCard} ${styles.dailyTrafficCard}`}>
        <div className={styles.subpanelTitle}><div><p className={styles.eyebrow}>Dzień po dniu</p><h3>Ile osób weszło</h3></div><span>ostatnie 30 dni</span></div>
        <div className={styles.dailyTrafficLegend} aria-hidden="true"><span><i className={styles.dailyPeopleKey} />Osoby</span><span><i className={styles.dailyViewsKey} />Odsłony</span></div>
        <div className={styles.dailyTrafficChart}>
          <svg viewBox="0 0 900 300" role="img" aria-labelledby="daily-chart-title daily-chart-description">
            <title id="daily-chart-title">Liczba wejść według dnia</title>
            <desc id="daily-chart-description">Daty na osi poziomej, liczba wejść na osi pionowej. Dwie linie pokazują osoby oraz odsłony.</desc>
            {dailyChart.ticks.map((tick) => <g key={tick}><line className={styles.chartGridLine} x1="52" x2="880" y1={dailyChart.y(tick)} y2={dailyChart.y(tick)} /><text className={styles.chartAxisText} x="42" y={dailyChart.y(tick) + 4} textAnchor="end">{tick}</text></g>)}
            <line className={styles.chartAxisLine} x1="52" x2="880" y1="250" y2="250" />
            <line className={styles.chartAxisLine} x1="52" x2="52" y1="35" y2="250" />
            {dailyChart.days.map((day, index) => index % 3 === 0 || index === dailyChart.days.length - 1 ? <text className={styles.chartAxisText} key={day.date} x={dailyChart.x(index)} y="273" textAnchor="middle">{day.date.slice(5).replace("-", ".")}</text> : null)}
            <polyline className={styles.chartPeopleLine} points={dailyChart.points((day) => day.uniqueVisitors)} />
            <polyline className={styles.chartViewsLine} points={dailyChart.points((day) => day.views)} />
            {dailyChart.days.map((day, index) => <g key={day.date}>
              <circle className={styles.chartPeoplePoint} cx={dailyChart.x(index)} cy={dailyChart.y(day.uniqueVisitors)} r="4"><title>{day.date}: {day.uniqueVisitors} przeglądarek</title></circle>
              <circle className={styles.chartViewsPoint} cx={dailyChart.x(index)} cy={dailyChart.y(day.views)} r="2.5"><title>{day.date}: {day.views} odsłon</title></circle>
            </g>)}
            <text className={styles.chartAxisLabel} x="466" y="296" textAnchor="middle">Data</text>
            <text className={styles.chartAxisLabel} x="13" y="143" textAnchor="middle" transform="rotate(-90 13 143)">Liczba wejść</text>
          </svg>
        </div>
        <p className={styles.trafficMuted}>„Osoby” to rozpoznane przeglądarki danego dnia. Pomiar tej liczby zaczyna się od publikacji poprawki; tryb prywatny i wyczyszczenie pamięci przeglądarki mogą zwiększyć wynik.</p>
      </article>

      <div className={styles.trafficGrid}>
        <article className={styles.trafficCard}>
          <div className={styles.subpanelTitle}><div><p className={styles.eyebrow}>1. Lejek konwersji</p><h3>Od wejścia do zapisu</h3></div></div>
          <ol className={styles.funnelList}>
            <li><span>Wejście</span><strong>{number.format(traffic?.totals.uniqueSessions ?? 0)}</strong></li>
            <li><span>Scroll 50%</span><strong>{number.format(traffic?.totals.events.scroll_50 ?? 0)}</strong></li>
            <li><span>Formularz rozpoczęty</span><strong>{number.format(traffic?.totals.events.form_started ?? 0)}</strong></li>
            <li><span>Próba zapisu</span><strong>{number.format(traffic?.totals.events.cta_attempt ?? 0)}</strong></li>
            <li><span>Zapis potwierdzony</span><strong>{number.format(traffic?.totals.events.signup ?? 0)}</strong></li>
          </ol>
        </article>
        <article className={styles.trafficCard}>
          <div className={styles.subpanelTitle}><div><p className={styles.eyebrow}>2. Zachowanie</p><h3>Jak czytają landing</h3></div></div>
          <div className={styles.behaviourRows}>
            <div><span>Dotarli do 25%</span><strong>{number.format(traffic?.totals.events.scroll_25 ?? 0)}</strong></div>
            <div><span>Dotarli do 75%</span><strong>{number.format(traffic?.totals.events.scroll_75 ?? 0)}</strong></div>
            <div><span>Dotarli do końca</span><strong>{number.format(traffic?.totals.events.scroll_100 ?? 0)}</strong></div>
            <div><span>Sesje z czasem</span><strong>{number.format(traffic?.totals.timedSessions ?? 0)}</strong></div>
          </div>
        </article>
        <article className={styles.trafficCard}>
          <div className={styles.subpanelTitle}><div><p className={styles.eyebrow}>3. Źródła</p><h3>Skąd przychodzą</h3></div></div>
          <div className={styles.sourceRows}>{traffic?.sources.length ? traffic.sources.map((source) => <div key={source.label}><strong>{source.label}</strong><span>{number.format(source.views)} wejść · {number.format(source.signups)} zapisów · {percent(source.signupRate)}</span></div>) : <p>Brak danych źródłowych.</p>}</div>
        </article>
        <article className={styles.trafficCard}>
          <div className={styles.subpanelTitle}><div><p className={styles.eyebrow}>4. Stan techniczny</p><h3>Czy strona odpowiada</h3></div></div>
          <div className={styles.technicalStatus}><span className={health?.status === "ok" ? styles.healthDotReady : styles.healthDotError} /><div><strong>{health?.status === "ok" ? "Landing działa" : health ? "Wymaga uwagi" : "Sprawdzam"}</strong><span>{health ? `Storage: ${health.storage} · odpowiedź ${health.responseTimeMs} ms` : "Pobieranie stanu"}</span></div></div>
          <p className={styles.trafficMuted}>To kontrola odpowiedzi aplikacji i bazy. Alerty e-mail dodamy, gdy ustalimy adres odbiorcy.</p>
        </article>
        <article className={styles.trafficCard}>
          <div className={styles.subpanelTitle}><div><p className={styles.eyebrow}>5. Aukcje</p><h3>Konwersja produktu</h3></div></div>
          <div className={styles.behaviourRows}>
            <div><span>Start płatności wpisowego</span><strong>{number.format(business?.totals.entry_checkout_started ?? 0)}</strong></div>
            <div><span>Opłacone wejścia</span><strong>{number.format(business?.totals.entry_paid ?? 0)}</strong></div>
            <div><span>Wygrane do opłacenia</span><strong>{number.format(business?.totals.winner_claimed ?? 0)}</strong></div>
            <div><span>Opłacone wygrane</span><strong>{number.format(business?.totals.order_paid ?? 0)}</strong></div>
          </div>
        </article>
        <article className={`${styles.trafficCard} ${styles.trafficInsight}`}>
          <div className={styles.subpanelTitle}><div><p className={styles.eyebrow}>6. Raport dnia</p><h3>Co robić dalej</h3></div></div>
          <strong>{insight}</strong>
          <span>{updatedAt ? `Dane odświeżone: ${updatedAt.toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}` : ""}</span>
        </article>
      </div>
    </section>
  );
}
