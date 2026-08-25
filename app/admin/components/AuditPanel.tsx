"use client";

import { useState } from "react";
import { ApiError, loadAuditPage } from "../api";
import type { AdminAuditEvent } from "../types";
import { formatDateTime } from "../utils";
import styles from "../AdminDashboard.module.css";

type AuditPanelProps = {
  onSessionExpired: () => void;
};

function eventLabel(value: string) {
  const known: Record<string, string> = {
    "auction.created": "Utworzono aukcję",
    "auction.updated": "Zmieniono aukcję",
    "auction.run.scheduled": "Zaplanowano rundę",
    "order.fulfillment.updated": "Zmieniono realizację zamówienia",
  };
  if (known[value]) return known[value];
  const label = value.replace(/[._-]+/g, " ").trim();
  return label ? label.charAt(0).toLocaleUpperCase("pl-PL") + label.slice(1) : "Zdarzenie";
}

function actorLabel(value: string) {
  if (value.startsWith("admin_clerk:")) return `konto administratora · ${value.slice("admin_clerk:".length)}`;
  if (value === "admin_clerk") return "konto administratora";
  if (value === "admin_session") return "panel administratora";
  if (value === "admin_api") return "dostęp administracyjny API";
  if (value === "system") return "system";
  return value;
}

function resourceLabel(value: string) {
  if (value === "auction") return "aukcja";
  if (value === "order") return "zamówienie";
  return value;
}

function detailLabel(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLocaleLowerCase("pl-PL");
}

export function AuditPanel({ onSessionExpired }: AuditPanelProps) {
  const [loaded, setLoaded] = useState(false);
  const [events, setEvents] = useState<AdminAuditEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadEvents = async (cursor: string | null, replace: boolean) => {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const page = await loadAuditPage(cursor);
      setEvents((current) => replace ? page.items : [...current, ...page.items]);
      setNextCursor(page.nextCursor);
      setLoaded(true);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        onSessionExpired();
        return;
      }
      setError(
        caught instanceof Error
          ? caught.message
          : "Nie udało się pobrać dziennika działań.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className={styles.panelSection} aria-labelledby="audit-heading">
      <div className={styles.sectionHeader}>
        <div>
          <p className={styles.eyebrow}>Kontrola</p>
          <h2 id="audit-heading">Pomocniczy dziennik działań</h2>
        </div>
        {loaded ? (
          <span className={styles.sectionCount} aria-label={`${events.length} załadowanych zdarzeń`}>
            {events.length}
          </span>
        ) : null}
      </div>

      {!loaded ? (
        <div className={styles.onDemandPrompt}>
          <div>
            <strong>Ostatnie operacje administracyjne</strong>
            <span>
              Pokazuje zapisane operacje panelu i jest pobierany dopiero na żądanie.
              Nie zastępuje formalnego rejestru księgowego ani bezpieczeństwa.
            </span>
          </div>
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={() => void loadEvents(null, true)}
            disabled={loading}
            aria-busy={loading}
          >
            {loading ? "Ładuję…" : "Pokaż ostatnie wpisy"}
          </button>
        </div>
      ) : null}

      {error ? <p className={styles.errorNotice} role="alert">{error}</p> : null}

      {loaded && events.length > 0 ? (
        <ol className={styles.auditList}>
          {events.map((event) => {
            const details = Object.entries(event.details);
            return (
              <li className={styles.auditEvent} key={event.eventId}>
                <div className={styles.auditEventTop}>
                  <div>
                    <strong>{eventLabel(event.event)}</strong>
                    <span>{formatDateTime(event.timestamp)}</span>
                  </div>
                  {event.entityId ? <code>{event.entityId}</code> : null}
                </div>
                <div className={styles.auditContext}>
                  {event.entityType ? <span>Zasób: {resourceLabel(event.entityType)}</span> : null}
                  {event.actor ? <span>Źródło: {actorLabel(event.actor)}</span> : null}
                </div>
                {details.length > 0 ? (
                  <dl className={styles.auditDetails}>
                    {details.map(([key, value]) => (
                      <div key={key}>
                        <dt>{detailLabel(key)}</dt>
                        <dd>{value === null ? "—" : String(value)}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : loaded && !loading && !error ? (
        <div className={styles.emptyState}>
          <strong>Dziennik jest jeszcze pusty</strong>
          <span>Zapisane operacje zobaczysz tutaj po ponownym wczytaniu dziennika.</span>
        </div>
      ) : null}

      {loaded && loading ? (
        <p className={styles.inlineStatus} role="status">Ładuję wpisy…</p>
      ) : null}

      {loaded && nextCursor && !loading ? (
        <div className={styles.loadMoreRow}>
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={() => void loadEvents(nextCursor, false)}
          >
            Załaduj starsze wpisy
          </button>
        </div>
      ) : null}
    </section>
  );
}
