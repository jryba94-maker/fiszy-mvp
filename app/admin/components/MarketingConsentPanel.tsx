"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "../AdminDashboard.module.css";

type ConsentEvent = { eventId: string; granted: boolean; occurredAt: string };
type ConsentRow = { accountId: string; email: string; status: "active" | "withdrawn"; source: string; updatedAt: string; history: ConsentEvent[] };
type Dashboard = { rows: ConsentRow[]; totals: { active: number; withdrawn: number; pending: number }; daily: Array<{ date: string; active: number; granted: number; withdrawn: number }>; limited: boolean };
const format = new Intl.DateTimeFormat("pl-PL", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Warsaw" });

export function MarketingConsentPanel({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [range, setRange] = useState<30 | 90>(30);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | ConsentRow["status"]>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/admin/marketing-consents?range=${range}`, { cache: "no-store", credentials: "same-origin" });
      if (response.status === 401) return onSessionExpired();
      const data = await response.json() as Dashboard & { outcome?: string };
      if (!response.ok) throw new Error("Nie udało się pobrać zgód marketingowych.");
      setDashboard(data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Nie udało się pobrać zgód marketingowych."); }
    finally { setLoading(false); }
  }, [onSessionExpired, range]);
  useEffect(() => { void load(); }, [load]);
  const rows = useMemo(() => dashboard?.rows.filter((row) => (status === "all" || row.status === status) && (!query.trim() || row.email.toLowerCase().includes(query.trim().toLowerCase()))) ?? [], [dashboard, query, status]);
  const max = Math.max(1, ...(dashboard?.daily.map((item) => item.active) ?? [1]));
  return <section className={styles.consentPanel} aria-busy={loading}>
    <div className={styles.sectionHeader}><div><p className={styles.eyebrow}>Marketing</p><h2>Zgody marketingowe</h2><p>Lista adresów, zmiany i historia zgód na e-mail.</p></div><div className={styles.cardActions}><button className={styles.secondaryButton} type="button" onClick={() => setRange(30)} aria-pressed={range === 30}>30 dni</button><button className={styles.secondaryButton} type="button" onClick={() => setRange(90)} aria-pressed={range === 90}>90 dni</button><button className={styles.secondaryButton} type="button" onClick={() => void load()} disabled={loading}>Odśwież</button><a className={styles.secondaryButton} href={`/api/admin/marketing-consents?range=${range}&format=csv`} download>Eksport aktywnych CSV</a></div></div>
    {error ? <p className={styles.errorNotice} role="alert">{error}</p> : null}
    <div className={styles.consentKpis}><div><span>Aktywne</span><strong>{dashboard?.totals.active ?? "—"}</strong></div><div><span>Wycofane</span><strong>{dashboard?.totals.withdrawn ?? "—"}</strong></div><div><span>Do potwierdzenia</span><strong>{dashboard?.totals.pending ?? "—"}</strong></div></div>
    <div className={styles.adminSubpanel}><div className={styles.subpanelTitle}><h3>Zmiany dzienne i wielkość bazy</h3><span>Aktywne · zapisy · wypisy</span></div><div className={styles.consentChart}>{(dashboard?.daily ?? []).map((item) => <div key={item.date} title={`${item.date}: ${item.active} aktywnych, +${item.granted}, −${item.withdrawn}`}><i style={{ height: `${Math.max(3, item.active / max * 100)}%` }} /><small>{item.date.slice(5)}</small></div>)}</div></div>
    <div className={styles.adminSubpanel}><div className={styles.subpanelTitle}><h3>Adresy i historia zgód</h3><span>{rows.length} adresów</span></div><div className={styles.portalFilters}><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Szukaj adresu e-mail" aria-label="Szukaj adresu e-mail" /><select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} aria-label="Status zgody"><option value="all">Wszystkie statusy</option><option value="active">Aktywna</option><option value="withdrawn">Wycofana</option></select></div>
      <div className={styles.consentRows}>{rows.map((row) => <article key={row.accountId} className={styles.consentRow}><div><strong>{row.email}</strong><small>{row.source} · {format.format(new Date(row.updatedAt))}</small></div><em className={row.status === "active" ? styles.activeBadge : styles.blockedBadge}>{row.status === "active" ? "Aktywna" : "Wycofana"}</em><button className={styles.secondaryButton} type="button" onClick={() => setOpen(open === row.accountId ? null : row.accountId)}>{open === row.accountId ? "Ukryj historię" : "Pokaż historię"}</button>{open === row.accountId ? <div className={styles.consentHistory}>{row.history.length ? row.history.map((event) => <p key={event.eventId}>{event.granted ? "Wyrażono zgodę" : "Wycofano zgodę"} · {format.format(new Date(event.occurredAt))}</p>) : <p>Brak zapisanej historii. Stan pochodzi z profilu użytkownika.</p>}</div> : null}</article>)}</div>
      {dashboard?.limited ? <p>Pokazano pierwsze 500 profili. Wraz ze wzrostem bazy dodamy stronicowanie.</p> : null}
    </div>
  </section>;
}
