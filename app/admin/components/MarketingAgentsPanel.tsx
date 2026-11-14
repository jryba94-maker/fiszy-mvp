"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import styles from "./MarketingAgentsPanel.module.css";

type Agent = "Social Listening" | "Community" | "Creative" | "Landing Page" | "A/B" | "Performance" | "Analityk" | "Lifecycle";
type Workflow = { id: string; brief: string; motive: string; audience: string; cta: string; auctionProduct: string; auctionStartsAt: string; communityNotes: string; createdAt: string; messages: Array<{ agent: Agent; content: string }> };
type Props = { onSessionExpired: () => void };

const DEFAULT_MOTIVE = "Cena spada. Ty wybierasz moment.";
const DEFAULT_AUDIENCE = "Osoby 20–40, które pamiętają emocje dawnych aukcji";
const DEFAULT_CTA = "Zapisz się do pierwszej aukcji";
const AGENT_LABELS: Record<Agent, string> = { "Social Listening": "trendy", Community: "społeczność", Creative: "kreacje", "Landing Page": "landing", "A/B": "test", Performance: "media", Analityk: "decyzja", Lifecycle: "aukcja" };

export function MarketingAgentsPanel({ onSessionExpired }: Props) {
  const [brief, setBrief] = useState("");
  const [motive, setMotive] = useState(DEFAULT_MOTIVE);
  const [audience, setAudience] = useState(DEFAULT_AUDIENCE);
  const [cta, setCta] = useState(DEFAULT_CTA);
  const [auctionProduct, setAuctionProduct] = useState("");
  const [auctionStartsAt, setAuctionStartsAt] = useState("");
  const [communityNotes, setCommunityNotes] = useState("");
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/marketing", { credentials: "same-origin", cache: "no-store" });
      if (response.status === 401) return onSessionExpired();
      const payload = await response.json() as { workflow?: Workflow; message?: string };
      if (!response.ok) throw new Error(payload.message ?? "Nie udało się odczytać historii agentów.");
      setWorkflow(payload.workflow ?? null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Nie udało się odczytać historii agentów."); }
    finally { setLoading(false); }
  }, [onSessionExpired]);

  useEffect(() => { void load(); }, [load]);

  const run = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!brief.trim() || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/admin/marketing", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brief, motive, audience, cta, auctionProduct, auctionStartsAt, communityNotes }) });
      if (response.status === 401) return onSessionExpired();
      const payload = await response.json() as { workflow?: Workflow; message?: string };
      if (!response.ok || !payload.workflow) throw new Error(payload.message ?? "Nie udało się uruchomić obiegu.");
      setWorkflow(payload.workflow); setBrief("");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Nie udało się uruchomić obiegu."); }
    finally { setBusy(false); }
  };

  return <section className={styles.panel} aria-busy={loading || busy}>
    <header className={styles.header}><div><p className={styles.eyebrow}>Fiszy Growth Engine</p><h2>Insight. Decyzja. Następny ruch.</h2><p>Trend → społeczność → kreacja → landing → test → media → analiza → lifecycle aukcji. Agenci rekomendują; publikacja i budżet zawsze wymagają Twojej decyzji.</p></div><span className={styles.live}><i />8 ról</span></header>
    <div className={styles.sourceStatus}><strong>Źródła danych</strong><span>Social: do podłączenia</span><span>DM / komentarze: notatki ręczne</span><span>Ads / analytics: do podłączenia</span></div>
    <div className={styles.layout}>
      <form className={styles.form} onSubmit={run}>
        <label><span>Cel / brief</span><textarea value={brief} onChange={(event) => setBrief(event.target.value)} placeholder="Np. Sprawdźmy, czy nostalgia po aukcjach daje lepsze zapisy niż sama obietnica spadającej ceny." maxLength={1600} required /></label>
        <label><span>Motyw</span><input value={motive} onChange={(event) => setMotive(event.target.value)} maxLength={1600} required /></label>
        <label><span>Odbiorca</span><input value={audience} onChange={(event) => setAudience(event.target.value)} maxLength={1600} required /></label>
        <label><span>Jedno CTA</span><input value={cta} onChange={(event) => setCta(event.target.value)} maxLength={1600} required /></label>
        <div className={styles.twoFields}><label><span>Produkt aukcji (opcjonalnie)</span><input value={auctionProduct} onChange={(event) => setAuctionProduct(event.target.value)} placeholder="np. PlayStation 5" maxLength={1600} /></label><label><span>Start aukcji</span><input type="datetime-local" value={auctionStartsAt} onChange={(event) => setAuctionStartsAt(event.target.value)} /></label></div>
        <label><span>Notatki z DM / komentarzy</span><textarea className={styles.notes} value={communityNotes} onChange={(event) => setCommunityNotes(event.target.value)} placeholder="Wklej komentarze, powtarzające się pytania lub insighty zespołu." maxLength={1600} /></label>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        <button className={styles.runButton} type="submit" disabled={!brief.trim() || busy}>{busy ? "GROWTH ENGINE PRACUJE…" : "URUCHOM PEŁNY OBIEG"}</button>
      </form>
      <div className={styles.thread}>
        <div className={styles.threadHead}><div><p className={styles.eyebrow}>ostatni obieg</p><h3>{workflow?.motive ?? "Czekam na brief"}</h3></div>{workflow ? <time>{new Date(workflow.createdAt).toLocaleString("pl-PL", { dateStyle: "medium", timeStyle: "short" })}</time> : null}</div>
        {workflow?.auctionProduct ? <p className={styles.auction}>Aukcja: <strong>{workflow.auctionProduct}</strong>{workflow.auctionStartsAt ? ` · ${new Date(workflow.auctionStartsAt).toLocaleString("pl-PL")}` : ""}</p> : null}
        {loading ? <p className={styles.empty}>Ładuję historię…</p> : workflow ? <><p className={styles.brief}>{workflow.brief}</p><div className={styles.messages}>{workflow.messages.map((message) => <article key={message.agent} className={styles.message}><div className={styles.agent}><span>{message.agent === "A/B" ? "A/B" : message.agent.slice(0, 1)}</span><div><strong>Agent {message.agent}</strong><small>{AGENT_LABELS[message.agent]}</small></div></div><p>{message.content}</p></article>)}</div></> : <p className={styles.empty}>Wpisz brief. Agent trendów i Community jasno pokażą, gdzie dane trzeba jeszcze podłączyć.</p>}
      </div>
    </div>
  </section>;
}
