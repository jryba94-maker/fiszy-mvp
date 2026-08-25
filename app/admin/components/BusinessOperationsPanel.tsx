"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "../AdminDashboard.module.css";

type Funnel = { totals: Record<string, number>; conversion: Record<string, number>; campaigns: Array<{ label: string; signups: number }> };
type Message = { messageId: string; template: string; state: string; attempts: number; recipient: string; updatedAt: string };
type ServiceCase = { caseId: string; kind: string; subject: string; description: string; orderId: string | null; expectation: string | null; status: string; contactEmail: string; responseDueAt: string; revision: number; adminResponse: string | null; resolution: string | null; refundStatus: string };
type PrivacyRequest = { requestId: string; kind: string; status: string; dueAt: string; revision: number };

type Props = { onSessionExpired: () => void };

const CASE_STATUS_LABELS: Record<string, string> = {
  submitted: "Nowe",
  reviewing: "W analizie",
  waiting_for_customer: "Czeka na klienta",
  accepted: "Uznane",
  rejected: "Odrzucone",
  completed: "Zakończone",
};

function allowedCaseStatuses(current: string) {
  const transitions: Record<string, string[]> = {
    submitted: ["submitted", "reviewing", "rejected"],
    reviewing: ["reviewing", "waiting_for_customer", "accepted", "rejected", "completed"],
    waiting_for_customer: ["waiting_for_customer", "reviewing", "accepted", "rejected"],
    accepted: ["accepted", "completed"],
    rejected: ["rejected"],
    completed: ["completed"],
  };
  return transitions[current] ?? [current];
}

async function api<T>(path: string, init?: RequestInit) {
  const response = await fetch(path, { ...init, credentials: "same-origin", headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const payload = await response.json().catch(() => ({})) as T & { outcome?: string };
  if (!response.ok) throw Object.assign(new Error(payload.outcome ?? "request_failed"), { status: response.status });
  return payload;
}

async function loadAllPages<T>(
  path: string,
  readPage: (payload: unknown) => { items: T[]; nextCursor: string | null },
) {
  const items: T[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 100; page += 1) {
    const separator = path.includes("?") ? "&" : "?";
    const payload: unknown = await api(`${path}${cursor ? `${separator}cursor=${encodeURIComponent(cursor)}` : ""}`);
    const result = readPage(payload);
    items.push(...result.items);
    cursor = result.nextCursor;
    if (!cursor) return items;
  }
  throw new Error("operations_page_limit");
}

export function BusinessOperationsPanel({ onSessionExpired }: Props) {
  const [funnel, setFunnel] = useState<Funnel | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [cases, setCases] = useState<ServiceCase[]>([]);
  const [privacy, setPrivacy] = useState<PrivacyRequest[]>([]);
  const [caseEdits, setCaseEdits] = useState<Record<string, { status: string; adminResponse: string; resolution: string; refundStatus: string }>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const [analytics, operations, serviceCases, privacyRequests] = await Promise.all([
        api<{ funnel: Funnel }>("/api/admin/analytics?days=30"),
        loadAllPages<Message>("/api/admin/operations", (payload) => {
          const outbox = (payload as { outbox: { messages: Message[]; nextCursor: string | null } }).outbox;
          return { items: outbox.messages, nextCursor: outbox.nextCursor };
        }),
        loadAllPages<ServiceCase>("/api/admin/cases", (payload) => {
          const page = payload as { cases: ServiceCase[]; nextCursor: string | null };
          return { items: page.cases, nextCursor: page.nextCursor };
        }),
        loadAllPages<PrivacyRequest>("/api/admin/privacy", (payload) => {
          const page = payload as { requests: PrivacyRequest[]; nextCursor: string | null };
          return { items: page.requests, nextCursor: page.nextCursor };
        }),
      ]);
      setFunnel(analytics.funnel);
      setMessages(operations);
      setCases(serviceCases);
      setPrivacy(privacyRequests);
    } catch (caught) {
      if ((caught as { status?: number }).status === 401) onSessionExpired();
      else setError("Nie udało się pobrać pełnego obrazu operacji.");
    } finally {
      setLoading(false);
    }
  }, [onSessionExpired]);

  useEffect(() => { void load(); }, [load]);

  const reconcile = async () => {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api<{ lifecycle: { processed: number; changed: number; recoveryRequired: number }; messages: { delivered: number; retried: number; dead: number } }>("/api/admin/operations", { method: "POST", body: "{}" });
      setNotice(`Sprawdzono ${result.lifecycle.processed} aukcji, zmieniono ${result.lifecycle.changed}; dostarczono ${result.messages.delivered} wiadomości.`);
      await load();
    } catch (caught) {
      if ((caught as { status?: number }).status === 401) onSessionExpired();
      else setError("Automatyczne sprawdzenie nie zostało ukończone.");
    } finally { setBusy(false); }
  };

  const updateCase = async (serviceCase: ServiceCase) => {
    setBusy(true); setError("");
    try {
      const draft = caseEdits[serviceCase.caseId] ?? {
        status: serviceCase.status,
        adminResponse: serviceCase.adminResponse ?? "",
        resolution: serviceCase.resolution ?? "",
        refundStatus: serviceCase.refundStatus,
      };
      await api(`/api/admin/cases/${encodeURIComponent(serviceCase.caseId)}`, { method: "PATCH", body: JSON.stringify({ expectedRevision: serviceCase.revision, status: draft.status, adminResponse: draft.adminResponse || null, resolution: draft.resolution || null, refundStatus: draft.refundStatus }) });
      setCaseEdits((current) => { const next = { ...current }; delete next[serviceCase.caseId]; return next; });
      setNotice(`Zapisano sprawę ${serviceCase.caseId}.`);
      await load();
    } catch (caught) {
      if ((caught as { status?: number }).status === 401) onSessionExpired();
      else setError("Nie udało się zmienić statusu sprawy.");
    } finally { setBusy(false); }
  };

  const updatePrivacy = async (request: PrivacyRequest, status: string) => {
    setBusy(true); setError("");
    try {
      await api(`/api/admin/privacy/${encodeURIComponent(request.requestId)}`, { method: "PATCH", body: JSON.stringify({ expectedRevision: request.revision, status, adminNote: null }) });
      await load();
    } catch (caught) {
      if ((caught as { status?: number }).status === 401) onSessionExpired();
      else setError("Nie udało się zmienić statusu wniosku RODO.");
    } finally { setBusy(false); }
  };

  return (
    <section className={styles.panelSection} aria-labelledby="operations-heading" aria-busy={loading}>
      <div className={styles.sectionHeader}><div><p className={styles.eyebrow}>Automatyzacja i kontrola</p><h2 id="operations-heading">Centrum operacyjne</h2></div><button className={styles.cardPrimaryButton} type="button" disabled={busy} onClick={() => void reconcile()}>{busy ? "Sprawdzam…" : "Uruchom kontrolę"}</button></div>
      {error ? <p className={styles.errorNotice} role="alert">{error}</p> : null}
      {notice ? <p className={styles.successNotice} role="status">{notice}</p> : null}
      <div className={styles.operationsKpis} aria-label="Lejek z ostatnich 30 dni">
        <div><strong>{funnel?.totals.waitlist_signup ?? 0}</strong><span>zapisy e-mail</span></div>
        <div><strong>{funnel?.totals.entry_paid ?? 0}</strong><span>opłacone wejścia</span></div>
        <div><strong>{funnel?.totals.winner_claimed ?? 0}</strong><span>decyzje zwycięskie</span></div>
        <div><strong>{funnel?.totals.order_paid ?? 0}</strong><span>opłacone zamówienia</span></div>
      </div>
      <div className={styles.operationsColumns}>
        <div className={styles.adminSubpanel}><div className={styles.subpanelTitle}><h3>Sprawy klientów</h3><span>{cases.length}</span></div><div className={styles.operationsList}>{cases.map((item) => {
          const draft = caseEdits[item.caseId] ?? { status: item.status, adminResponse: item.adminResponse ?? "", resolution: item.resolution ?? "", refundStatus: item.refundStatus };
          const updateDraft = (patch: Partial<typeof draft>) => setCaseEdits((current) => ({ ...current, [item.caseId]: { ...draft, ...patch } }));
          return <article className={styles.operationCase} key={item.caseId}><div><strong>{item.subject}</strong><span>{item.caseId} · {item.kind} · termin {new Date(item.responseDueAt).toLocaleDateString("pl-PL")}</span><span>{item.contactEmail}{item.orderId ? ` · zamówienie ${item.orderId}` : ""}</span><p>{item.description}</p>{item.expectation ? <p><strong>Oczekiwanie:</strong> {item.expectation}</p> : null}</div><div className={styles.operationsFormGrid}><label className={styles.field}><span>Status</span><select className={styles.input} value={draft.status} onChange={(event) => updateDraft({ status: event.target.value })}>{allowedCaseStatuses(item.status).map((status) => <option key={status} value={status}>{CASE_STATUS_LABELS[status] ?? status}</option>)}</select></label><label className={styles.field}><span>Zwrot środków</span><select className={styles.input} value={draft.refundStatus} onChange={(event) => updateDraft({ refundStatus: event.target.value })}><option value="not_applicable">Nie dotyczy</option><option value="pending">Do wykonania</option><option value="completed">Wykonany</option></select></label></div><label className={styles.field}><span>Odpowiedź dla klienta</span><textarea className={styles.input} rows={3} maxLength={3000} value={draft.adminResponse} onChange={(event) => updateDraft({ adminResponse: event.target.value })} /></label><label className={styles.field}><span>Rozwiązanie wewnętrzne</span><textarea className={styles.input} rows={2} maxLength={2000} value={draft.resolution} onChange={(event) => updateDraft({ resolution: event.target.value })} /></label><div className={styles.cardActions}><button type="button" className={styles.cardPrimaryButton} disabled={busy} onClick={() => void updateCase(item)}>Zapisz sprawę</button></div></article>;
        })}</div>{!loading && !cases.length ? <p className={styles.emptyState}>Brak spraw klientów.</p> : null}</div>
        <div className={styles.adminSubpanel}><div className={styles.subpanelTitle}><h3>Wnioski RODO</h3><span>{privacy.length}</span></div><div className={styles.operationsList}>{privacy.map((item) => <article className={styles.compactOperation} key={item.requestId}><div><strong>{item.kind}</strong><span>{item.status} · termin {new Date(item.dueAt).toLocaleDateString("pl-PL")}</span></div><div className={styles.cardActions}>{item.status === "requested" ? <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => void updatePrivacy(item, "verified")}>Zweryfikuj</button> : null}{item.status === "verified" ? <button type="button" className={styles.secondaryButton} disabled={busy} onClick={() => void updatePrivacy(item, "processing")}>Przetwarzaj</button> : null}</div></article>)}</div>{!privacy.length ? <p className={styles.emptyState}>Brak nowych wniosków.</p> : null}</div>
      </div>
      <div className={styles.adminSubpanel}><div className={styles.subpanelTitle}><h3>Kolejka wiadomości</h3><span>{messages.length}</span></div><div className={styles.operationsList}>{messages.slice(0, 100).map((message) => <div className={styles.compactOperation} key={message.messageId}><div><strong>{message.template}</strong><span>{message.state} · próby: {message.attempts}</span></div><time dateTime={message.updatedAt}>{new Date(message.updatedAt).toLocaleString("pl-PL")}</time></div>)}</div>{!loading && !messages.length ? <p className={styles.emptyState}>Kolejka jest pusta.</p> : null}</div>
    </section>
  );
}
