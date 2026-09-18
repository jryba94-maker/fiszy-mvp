"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import styles from "./MarketingAgentsPanel.module.css";

type Workflow = { id: string; brief: string; motive: string; audience: string; cta: string; createdAt: string; messages: Array<{ agent: "Creative" | "A/B" | "Performance"; content: string }> };
type Props = { onSessionExpired: () => void };

const DEFAULT_MOTIVE = "Cena spada. Ty wybierasz moment.";
const DEFAULT_AUDIENCE = "Osoby 20–40, które pamiętają emocje dawnych aukcji";
const DEFAULT_CTA = "Zapisz się do pierwszej aukcji";

export function MarketingAgentsPanel({ onSessionExpired }: Props) {
  const [brief, setBrief] = useState("");
  const [motive, setMotive] = useState(DEFAULT_MOTIVE);
  const [audience, setAudience] = useState(DEFAULT_AUDIENCE);
  const [cta, setCta] = useState(DEFAULT_CTA);
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
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Nie udało się odczytać historii agentów.");
    } finally { setLoading(false); }
  }, [onSessionExpired]);

  useEffect(() => { void load(); }, [load]);

  const run = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!brief.trim() || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/admin/marketing", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ brief, motive, audience, cta }) });
      if (response.status === 401) return onSessionExpired();
      const payload = await response.json() as { workflow?: Workflow; message?: string };
      if (!response.ok || !payload.workflow) throw new Error(payload.message ?? "Nie udało się uruchomić obiegu.");
      setWorkflow(payload.workflow); setBrief("");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Nie udało się uruchomić obiegu."); }
    finally { setBusy(false); }
  };

  return <section className={styles.panel} aria-busy={loading || busy}>
    <header className={styles.header}><div><p className={styles.eyebrow}>Marketing / agenci</p><h2>Jedna decyzja. Jeden obieg.</h2><p>Creative przygotowuje warianty, A/B ogranicza test do jednej zmiennej, a Performance ustawia pomiar. Kampanii nie uruchomią bez Ciebie.</p></div><span className={styles.live}><i />gotowi</span></header>
    <div className={styles.layout}>
      <form className={styles.form} onSubmit={run}>
        <label><span>Cel / brief</span><textarea value={brief} onChange={(event) => setBrief(event.target.value)} placeholder="Np. Sprawdźmy, czy nostalgia po aukcjach daje lepsze zapisy niż sama obietnica spadającej ceny." maxLength={1600} required /></label>
        <label><span>Motyw</span><input value={motive} onChange={(event) => setMotive(event.target.value)} maxLength={1600} required /></label>
        <label><span>Odbiorca</span><input value={audience} onChange={(event) => setAudience(event.target.value)} maxLength={1600} required /></label>
        <label><span>Jedno CTA</span><input value={cta} onChange={(event) => setCta(event.target.value)} maxLength={1600} required /></label>
        {error ? <p className={styles.error} role="alert">{error}</p> : null}
        <button className={styles.runButton} type="submit" disabled={!brief.trim() || busy}>{busy ? "AGENTY PRACUJĄ…" : "URUCHOM OBIEG"}</button>
      </form>
      <div className={styles.thread}>
        <div className={styles.threadHead}><div><p className={styles.eyebrow}>ostatni obieg</p><h3>{workflow?.motive ?? "Czekam na brief"}</h3></div>{workflow ? <time>{new Date(workflow.createdAt).toLocaleString("pl-PL", { dateStyle: "medium", timeStyle: "short" })}</time> : null}</div>
        {loading ? <p className={styles.empty}>Ładuję historię…</p> : workflow ? <><p className={styles.brief}>{workflow.brief}</p><div className={styles.messages}>{workflow.messages.map((message) => <article key={message.agent} className={styles.message}><div className={styles.agent}><span className={styles[`agent_${message.agent.replace("/", "")}`]}>{message.agent === "Creative" ? "C" : message.agent === "A/B" ? "A/B" : "P"}</span><div><strong>Agent {message.agent}</strong><small>{message.agent === "Creative" ? "kreacje" : message.agent === "A/B" ? "test" : "media"}</small></div></div><p>{message.content}</p></article>)}</div></> : <p className={styles.empty}>Wpisz brief po lewej. Pierwszy obieg pokaże pełne przekazanie pracy między agentami.</p>}
      </div>
    </div>
  </section>;
}
