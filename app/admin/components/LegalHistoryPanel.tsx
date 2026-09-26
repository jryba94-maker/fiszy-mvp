"use client";

import { useState } from "react";
import { ApiError, loadLegalDocuments } from "../api";
import type { AdminLegalDocument } from "../types";
import { formatDateTime } from "../utils";
import styles from "../AdminDashboard.module.css";

export function LegalHistoryPanel({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [items, setItems] = useState<AdminLegalDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const load = async () => { setLoading(true); setError(""); try { setItems(await loadLegalDocuments()); } catch (caught) { if (caught instanceof ApiError && caught.status === 401) return onSessionExpired(); setError(caught instanceof Error ? caught.message : "Nie udało się pobrać historii dokumentów."); } finally { setLoading(false); } };
  return <section className={styles.panelSection} aria-labelledby="legal-history-heading"><div className={styles.sectionHeader}><div><p className={styles.eyebrow}>Zgodność</p><h2 id="legal-history-heading">Historia dokumentów</h2><p>Aktywne i archiwalne wersje regulaminów oraz zasad. Każdy plik jest pobierany w wersji niezmiennej.</p></div><button className={styles.secondaryButton} onClick={() => void load()} disabled={loading}>{loading ? "Ładowanie…" : "Pokaż historię"}</button></div>{error ? <p className={styles.errorMessage}>{error}</p> : null}{items.length ? <div className={styles.sectionStack}>{items.map((item) => <article className={styles.adminSubpanel} key={`${item.id}-${item.version}`}><div className={styles.sectionHeader}><div><h3>{item.title} <span className={styles.environment}>v{item.version}</span></h3><p>{item.status === "active" ? "Wersja obowiązująca" : "Wersja archiwalna"} · obowiązuje od {formatDateTime(item.effectiveAt)} · opublikowano {formatDateTime(item.publishedAt)}</p></div><a className={styles.secondaryButton} href={`/api/admin/legal-documents/${encodeURIComponent(item.id)}/${encodeURIComponent(item.version)}/download`}>Pobierz plik</a></div></article>)}</div> : !loading ? <p className={styles.emptyState}>Kliknij „Pokaż historię”, aby załadować rejestr wersji.</p> : null}</section>;
}
