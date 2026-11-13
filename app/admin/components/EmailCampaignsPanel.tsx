"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "../AdminDashboard.module.css";
import { MarketingConsentPanel } from "./MarketingConsentPanel";

type Content = { name: string; subject: string; text: string; imageUrl: string; ctaLabel: string; ctaUrl: string; segment: "all" | "recent" | "waitlist" | "press" };
type Campaign = Content & {
  id: string; revision: number; state: "draft" | "queued" | "paused" | "completed" | "cancelled";
  scheduledAt: string | null; audience: number; processed: number; accepted: number; skipped: number; failed: number;
};

const PRESS_CONTACTS = [
  ["ZiemiaLubuska.pl","redakcja@ziemialubuska.pl"],
  ["MamStartup","redakcja@mamstartup.pl"],
  ["Ecommerceportal.pl","redakcja@ecommerceportal.pl"],
  ["Gram.pl","redakcja@gram.pl"],
  ["My Company Polska","redakcja@mycompanypolska.pl"],
  ["BRIEF","redakcja@brief.pl"],
  ["Dziś we Wrocławiu","kontakt@dziswewroclawiu.pl"],
  ["Metropolia Bydgoska","redakcja@metropoliabydgoska.pl"],
  ["TuŁódź","redakcja@tulodz.pl"],
  ["LoveKraków","redakcja@lovekrakow.pl"],
  ["TuStolica","redakcja@gazetaecho.pl"],
  ["24Opole","redakcja@24opole.pl"],
  ["Rzeszów News","redakcja@rzeszow-news.pl"],
  ["BiałystokOnline","24@bialystokonline.pl"],
  ["Katowice24","redakcja@katowice24.info"],
  ["Portal Kielecki","portalkielecki.pl@gmail.com"],
  ["Metro Poznań","redakcja@metropoznan.pl"],
  ["wSzczecinie.pl","wiadomosci@wszczecinie.pl"],
] as const;

const EMPTY: Content = { name: "", subject: "", text: "", imageUrl: "", ctaLabel: "", ctaUrl: "", segment: "all" };
const STATES = { draft: "Szkic", queued: "W kolejce", paused: "Wstrzymana", completed: "Zakończona", cancelled: "Anulowana" };
const ERRORS: Record<string, string> = {
  invalid_content: "Uzupełnij nazwę, temat i treść. Przycisk wymaga etykiety i linku na stronie Fiszy.",
  invalid_schedule: "Wybierz termin w ciągu następnych 30 dni.",
  empty_audience: "Brak kont z aktywną zgodą w tym segmencie.",
  audience_too_large: "Segment przekracza limit kampanii. Wybierz węższą grupę.",
  revision_conflict: "Kampania zmieniła się w innym oknie. Odśwież listę.",
  busy: "Kampania jest przetwarzana. Spróbuj ponownie za chwilę.",
  email_not_configured: "Brakuje konfiguracji do wysyłki kampanii w tym środowisku.",
  test_not_configured: "Adres kontrolny lub wysyłka nie są skonfigurowane.",
  test_recipient_unsubscribed: "Adres kontrolny został wypisany z kampanii.",
  invalid_image: "Wgraj plik JPG, PNG, WEBP lub GIF o wielkości do 5 MB.",
  upload_failed: "Nie udało się wgrać grafiki. Spróbuj ponownie za chwilę.",
  forbidden: "Brak uprawnień do tej operacji.",
};
const time = new Intl.DateTimeFormat("pl-PL", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Warsaw" });

export function EmailCampaignsPanel({ canWrite, onSessionExpired }: { canWrite: boolean; onSessionExpired: () => void }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<Content>(EMPTY);
  const [dirty, setDirty] = useState(false);
  const [delivery, setDelivery] = useState<{ id: string; stats: Record<string, number> } | null>(null);
  const [estimate, setEstimate] = useState<number | null>(null);
  const [schedule, setSchedule] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [imageUploading, setImageUploading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [stopping, setStopping] = useState(false);
  const stopRequested = useRef(false);
  const [sendingConfigured, setSendingConfigured] = useState(false);
  const [testConfigured, setTestConfigured] = useState(false);
  const active = useRef(true);
  const selected = campaigns.find((item) => item.id === selectedId);
  const editable = canWrite && (!selected || selected.state === "draft");

  const api = useCallback(async (path = "", body?: object) => {
    const response = await fetch(`/api/admin/campaigns${path}`, {
      cache: "no-store",
      ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
    });
    if (response.status === 401) onSessionExpired();
    const data = await response.json();
    if (!response.ok) throw new Error(ERRORS[data.outcome] ?? "Nie udało się wykonać operacji. Odśwież listę i spróbuj ponownie.");
    return data;
  }, [onSessionExpired]);

  const load = useCallback(async () => {
    const result = await api();
    setCampaigns(result.campaigns);
    setSendingConfigured(result.sendingConfigured);
    setTestConfigured(result.testConfigured);
  }, [api]);

  useEffect(() => {
    active.current = true;
    void load().catch((cause) => { if (active.current) setError(cause.message); });
    return () => { active.current = false; };
  }, [load]);

  function select(item?: Campaign) {
    if (dirty && !window.confirm("Porzucić niezapisane zmiany?")) return;
    setSelectedId(item?.id ?? null);
    setForm(item ?? EMPTY);
    setDirty(false);
    setEstimate(null);
    setDelivery(null);
    setSchedule("");
    setNotice("");
    setError("");
  }

  function update(field: keyof Content, value: string) {
    setForm((previous) => ({ ...previous, [field]: value }));
    setDirty(true);
    if (field === "segment") setEstimate(null);
  }

  async function uploadImage(file: File | null) {
    if (!file || imageUploading) return;
    setImageUploading(true);
    setError("");
    try {
      const body = new FormData();
      body.set("image", file);
      const response = await fetch("/api/admin/campaigns/upload", { method: "POST", credentials: "same-origin", body });
      if (response.status === 401) return onSessionExpired();
      const result = await response.json() as { outcome?: string; url?: string };
      if (!response.ok || !result.url) throw new Error(ERRORS[result.outcome ?? ""] ?? "Nie udało się wgrać grafiki.");
      update("imageUrl", result.url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Nie udało się wgrać grafiki.");
    } finally {
      setImageUploading(false);
    }
  }

  function remember(item: Campaign) {
    setCampaigns((previous) => previous.some((row) => row.id === item.id)
      ? previous.map((row) => row.id === item.id ? item : row)
      : [item, ...previous]);
  }

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try { await task(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Nie udało się wykonać operacji."); }
    finally { setBusy(false); }
  }

  async function action(kind: "queue" | "pause" | "resume" | "cancel" | "test" | "process") {
    if (!selected) return;
    if (kind === "queue" && !window.confirm("Dodać tę kampanię do kolejki wysyłkowej? Treść i segment zostaną zapisane.")) return;
    if (kind === "cancel" && !window.confirm("Anulować dalszą wysyłkę tej kampanii?")) return;
    if (kind === "process" && !window.confirm("Rozpocząć wysyłkę oczekujących wiadomości z tej kampanii?")) return;
    await run(async () => {
      if (kind === "process") {
        let current = selected;
        stopRequested.current = false;
        setProcessing(true);
        try {
          while (active.current && current.state === "queued") {
            const next: Campaign = (await api("", { action: kind, id: selected.id })).campaign;
            remember(next);
            if (stopRequested.current && next.state === "queued") {
              const paused = (await api("", { action: "pause", id: selected.id, revision: next.revision })).campaign;
              remember(paused);
              setNotice("Kampania została wstrzymana po bieżącej partii.");
              return;
            }
            if (next.processed <= current.processed) break;
            current = next;
          }
          setNotice("Przetwarzanie zakończone. Stan wysyłki znajdziesz w raporcie kampanii.");
        } finally {
          setProcessing(false);
          setStopping(false);
        }
      } else {
        const result = await api("", { action: kind, id: selected.id, revision: selected.revision, scheduledAt: kind === "queue" && schedule ? new Date(schedule).toISOString() : undefined });
        if (result.campaign) remember(result.campaign);
        setNotice(kind === "test" ? "Operator przyjął wiadomość testową na skonfigurowany adres." : "Stan kampanii został zapisany.");
      }
    });
  }

  return (
    <section className={styles.panelSection} aria-labelledby="campaign-heading" aria-busy={busy}>
      <MarketingConsentPanel onSessionExpired={onSessionExpired} />
      <details className={styles.adminSubpanel}>
        <summary>Portale informacyjne ({PRESS_CONTACTS.length})</summary>
        <p>Kontakty redakcyjne do indywidualnych zgłoszeń prasowych.</p>
        <ul>
          {PRESS_CONTACTS.map(([name, email]) => (
            <li key={email}>{name} · <a href={`mailto:${email}`}>{email}</a></li>
          ))}
        </ul>
        <p><a href="https://24zielonagora.pl/strona/redakcja">24 Zielona Góra — kontakt przez stronę redakcji</a></p>
      </details>
      <div className={styles.sectionHeader}>
        <div><p className={styles.eyebrow}>Marketing</p><h2 id="campaign-heading">Kampanie e-mail</h2></div>
        <div className={styles.cardActions}>
          <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => void run(load)}>Odśwież</button>
          {canWrite ? <button type="button" className={styles.cardPrimaryButton} disabled={busy} onClick={() => select()}>Nowa kampania</button> : null}
        </div>
      </div>
      {error ? <p className={styles.errorNotice} role="alert">{error}</p> : null}
      {notice ? <p className={styles.successNotice} role="status">{notice}</p> : null}
      <div className={styles.operationsColumns}>
        <div className={styles.adminSubpanel}>
          <h3>Ostatnie kampanie</h3>
          {campaigns.length ? <div className={styles.operationsList}>{campaigns.map((item) => (
            <button key={item.id} type="button" className={styles.secondaryButton} disabled={busy} aria-pressed={selectedId === item.id} onClick={() => select(item)}>
              {item.name} · {STATES[item.state]}
            </button>
          ))}</div> : <p>Brak kampanii.</p>}
        </div>
        <div className={styles.adminSubpanel}>
          {editable ? <form onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              const item: Campaign = (await api("", { action: "save", id: selectedId ?? undefined, revision: selected?.revision, content: form })).campaign;
              remember(item);
              setSelectedId(item.id);
              setForm(item);
              setDirty(false);
              setNotice("Szkic został zapisany.");
            });
          }}>
            <h3>{selected ? "Edycja szkicu" : "Nowa kampania"}</h3>
            <fieldset disabled={busy} className={styles.operationsFormGrid}>
              <label className={styles.field}>Nazwa wewnętrzna<input className={styles.input} required maxLength={100} value={form.name} onChange={(e) => update("name", e.target.value)} /></label>
              <label className={styles.field}>Temat wiadomości<input className={styles.input} required maxLength={150} value={form.subject} onChange={(e) => update("subject", e.target.value)} /></label>
              <label className={styles.field}>Treść<textarea className={styles.input} required rows={9} maxLength={12000} value={form.text} onChange={(e) => update("text", e.target.value)} /></label>
              <label className={styles.field}>Grafika wiadomości
                <input className={styles.input} type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={imageUploading} onChange={(event) => void uploadImage(event.target.files?.[0] ?? null)} />
                <small>{imageUploading ? "Wgrywam grafikę…" : "JPG, PNG, WEBP lub GIF, maks. 5 MB."}</small>
              </label>
              {form.imageUrl ? <div className={styles.imageControl}>
                <img src={form.imageUrl} alt="Wgrana grafika kampanii" />
                <button type="button" className={styles.secondaryButton} disabled={imageUploading} onClick={() => update("imageUrl", "")}>Usuń grafikę</button>
              </div> : null}
              <label className={styles.field}>Segment<select className={styles.input} value={form.segment} onChange={(e) => update("segment", e.target.value)}><option value="all">Wszystkie konta ze zgodą marketingową</option><option value="recent">Nowe konta ze zgodą z ostatnich 30 dni</option><option value="waitlist">Lista zainteresowanych pierwszą aukcją</option><option value="press">Portale informacyjne (18 redakcji)</option></select></label>
              <label className={styles.field}>Tekst przycisku<input className={styles.input} maxLength={80} value={form.ctaLabel} onChange={(e) => update("ctaLabel", e.target.value)} /></label>
              <label className={styles.field}>Link na Fiszy<input className={styles.input} maxLength={450} placeholder="/aukcje" value={form.ctaUrl} onChange={(e) => update("ctaUrl", e.target.value)} /></label>
            </fieldset>
            <div className={styles.cardActions}>
              <button type="submit" className={styles.cardPrimaryButton} disabled={busy}>Zapisz szkic</button>
              <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => void run(async () => setEstimate((await api(`?segment=${form.segment}`)).eligible))}>Policz odbiorców</button>
            </div>
            {estimate !== null ? <p role="status">Odbiorcy w segmencie: <strong>{estimate}</strong>. Adresy i wypisy zostaną zweryfikowane przy wysyłce.</p> : null}
          </form> : <h3>{selected?.name ?? "Wybierz kampanię"}</h3>}
          {selected?.state === "draft" && canWrite ? <div className={styles.operationsList}>
            <label className={styles.field}>Najwcześniejszy termin (czas urządzenia)<input className={styles.input} type="datetime-local" value={schedule} disabled={busy} onChange={(e) => setSchedule(e.target.value)} /></label>
            <p>Puste pole pozwala wysłać kampanię od razu. Wysyłka automatyczna działa w dziennym cyklu serwera.</p>
            <div className={styles.cardActions}>
              <button className={styles.secondaryButton} type="button" disabled={busy || dirty || !sendingConfigured || !testConfigured} onClick={() => void action("test")}>Wyślij test</button>
              <button className={styles.cardPrimaryButton} type="button" disabled={busy || dirty || !sendingConfigured} onClick={() => void action("queue")}>Dodaj do kolejki</button>
            </div>
            {!sendingConfigured ? <p>Wysyłka kampanii jest niedostępna w tym środowisku.</p> : !testConfigured ? <p>Wysyłka testowa wymaga adresu kontrolnego.</p> : null}
          </div> : null}
        </div>
      </div>
      {selected || editable ? <section className={`${styles.adminSubpanel} ${styles.emailPreviewPanel}`} aria-label="Podgląd wiadomości">
        <div className={styles.previewTopline}><div><p className={styles.eyebrow}>Podgląd wiadomości</p><h3>{form.subject || "Temat wiadomości"}</h3></div><span>Desktop</span></div>
        <article className={styles.emailPreview}>
          <p className={styles.previewBrand}>Fiszy<span>.</span></p>
          {form.imageUrl ? <img className={styles.previewImage} src={form.imageUrl} alt="Grafika kampanii" /> : null}
          <div className={styles.previewBody}>{form.text || "Wpisz treść wiadomości."}</div>
          {form.ctaLabel && form.ctaUrl ? <span className={styles.previewButton}>{form.ctaLabel}</span> : null}
          <p className={styles.previewUnsubscribe}>Wypisz się z marketingu Fiszy</p>
        </article>
      </section> : null}
      {selected && selected.state !== "draft" ? <div className={styles.adminSubpanel}>
        <h3>Raport wysyłki</h3>
        <p>{STATES[selected.state]}{selected.scheduledAt ? ` · od ${time.format(new Date(selected.scheduledAt))} (Warszawa)` : ""}</p>
        <progress aria-label="Przetworzeni odbiorcy" value={selected.processed} max={selected.audience || 1} />
        <p>Przetworzono {selected.processed} z {selected.audience} · operator przyjął {selected.accepted} · pominięto {selected.skipped} · błędy {selected.failed}</p>
        <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => void run(async () => {
          const result = await api(`?stats=${encodeURIComponent(selected.id)}`);
          setDelivery({ id: selected.id, stats: result.stats });
        })}>Pobierz raport Resend</button>
        {delivery?.id === selected.id ? <div>
          <p>Dostarczono {delivery.stats.delivered} · odbicia {delivery.stats.bounced} · błędy dostawy {delivery.stats.failed} · wstrzymane przez operatora {delivery.stats.suppressed} · skargi {delivery.stats.complained}</p>
          <p>Wiadomości z sygnałem otwarcia: {delivery.stats.opened}. Wiadomości z sygnałem kliknięcia: {delivery.stats.clicked}. Dane zależą od zdarzeń włączonych w Resend.</p>
        </div> : null}
        {canWrite ? <div className={styles.cardActions}>
          {selected.state === "queued" ? <>
            <button type="button" className={styles.cardPrimaryButton} disabled={busy || !sendingConfigured || Date.parse(selected.scheduledAt ?? "") > Date.now()} onClick={() => void action("process")}>Uruchom wysyłkę</button>
            <button type="button" className={styles.secondaryButton} disabled={stopping || (busy && !processing)} onClick={() => {
              if (processing) {
                stopRequested.current = true;
                setStopping(true);
              } else void action("pause");
            }}>{stopping ? "Wstrzymuję po partii…" : "Wstrzymaj"}</button>
          </> : null}
          {selected.state === "paused" ? <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => void action("resume")}>Wznów</button> : null}
          {selected.state === "queued" || selected.state === "paused" ? <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => void action("cancel")}>Anuluj kampanię</button> : null}
        </div> : null}
      </div> : null}
    </section>
  );
}
