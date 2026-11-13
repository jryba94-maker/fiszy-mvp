"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { auctionRunPath } from "../../../lib/auction";
import type { AdminAuction, AuctionFilter } from "../types";
import {
  STATUS_LABELS,
  countdownLabel,
  formatDateTime,
  formatMoney,
  isAuctionActive,
  matchesAuctionSearch,
  matchesFilter,
  sortAuctions,
} from "../utils";
import styles from "../AdminDashboard.module.css";
import { ProductThumb } from "./ProductThumb";

const FILTERS: Array<{ value: AuctionFilter; label: string }> = [
  { value: "all", label: "Wszystkie" },
  { value: "live", label: "Live" },
  { value: "waiting", label: "Oczekujące" },
  { value: "finished", label: "Zakończone" },
  { value: "draft", label: "Szkice" },
  { value: "archived", label: "Archiwum" },
];

type AuctionListProps = {
  auctions: AdminAuction[];
  filter: AuctionFilter;
  searchQuery: string;
  busyAuctionId: string | null;
  onFilterChange: (filter: AuctionFilter) => void;
  onSearchChange: (query: string) => void;
  onOrder?: (runId: string) => void;
  onDetails?: (auctionId: string) => void;
  onEdit: (auction: AdminAuction) => void;
  onDuplicate: (auction: AdminAuction) => void;
  onStart: (auction: AdminAuction, startsAt: string) => void;
  onArchiveToggle: (auction: AdminAuction) => void;
  onCancelRun: (auction: AdminAuction) => void;
};

function filterCount(auctions: AdminAuction[], filter: AuctionFilter) {
  return auctions.filter((auction) => matchesFilter(auction, filter)).length;
}

function localDateTime(date: Date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

export function AuctionList({
  auctions,
  filter,
  searchQuery,
  busyAuctionId,
  onFilterChange,
  onSearchChange,
  onOrder,
  onDetails,
  onEdit,
  onDuplicate,
  onStart,
  onArchiveToggle,
  onCancelRun,
}: AuctionListProps) {
  const [copyNotice, setCopyNotice] = useState<{ id: string; message: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [schedulingId, setSchedulingId] = useState<string | null>(null);
  const [scheduledStart, setScheduledStart] = useState("");
  const [scheduleError, setScheduleError] = useState("");
  const deferredSearch = useDeferredValue(searchQuery);
  const hasTimedAuction = auctions.some(
    (auction) => auction.status === "waiting" || auction.status === "live",
  );

  useEffect(() => {
    if (!hasTimedAuction) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasTimedAuction]);

  const filteredAuctions = useMemo(
    () => sortAuctions(auctions).filter(
      (auction) =>
        matchesFilter(auction, filter) && matchesAuctionSearch(auction, deferredSearch),
    ),
    [auctions, deferredSearch, filter],
  );
  const catalogCount = filterCount(auctions, "all");
  const workflowCounts = useMemo(() => ({
    draft: auctions.filter((auction) => auction.recordState === "draft").length,
    waiting: auctions.filter((auction) => auction.status === "waiting").length,
    live: auctions.filter((auction) => auction.status === "live" || auction.status === "payment_pending").length,
    finished: filterCount(auctions, "finished"),
  }), [auctions]);

  const openSchedule = (auctionId: string) => {
    setSchedulingId(auctionId);
    setScheduledStart(localDateTime(new Date(Date.now() + 5 * 60_000)));
    setScheduleError("");
  };

  const scheduleRun = (auction: AdminAuction) => {
    const startsAt = new Date(scheduledStart);
    if (!Number.isFinite(startsAt.getTime()) || startsAt.getTime() <= Date.now()) {
      setScheduleError("Wybierz godzinę rozpoczęcia w przyszłości.");
      return;
    }
    setScheduleError("");
    setSchedulingId(null);
    onStart(auction, startsAt.toISOString());
  };

  return (
    <section className={styles.panelSection} aria-labelledby="auctions-heading">
      <div className={styles.sectionHeader}>
        <div>
          <p className={styles.eyebrow}>Katalog</p>
          <h2 id="auctions-heading">Wszystkie aukcje</h2>
        </div>
        <span className={styles.sectionCount} aria-label={`${catalogCount} aukcji`}>
          {catalogCount}
        </span>
      </div>

      <div className={styles.listToolbar}>
        <label className={styles.searchField} htmlFor="auction-search">
          <span className={styles.srOnly}>Szukaj aukcji</span>
          <input
            id="auction-search"
            className={styles.input}
            type="search"
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Szukaj po nazwie, slugu lub ID…"
            autoComplete="off"
          />
        </label>
        <span className={styles.resultCount} aria-live="polite">
          Wyniki: {filteredAuctions.length}
        </span>
      </div>

      <div className={styles.workflowOverview} aria-label="Etapy aukcji">
        <button type="button" onClick={() => onFilterChange("draft")}><span>Szkice</span><strong>{workflowCounts.draft}</strong><small>do przygotowania</small></button>
        <button type="button" onClick={() => onFilterChange("waiting")}><span>Zaplanowane</span><strong>{workflowCounts.waiting}</strong><small>czekają na start</small></button>
        <button type="button" onClick={() => onFilterChange("live")}><span>Trwające</span><strong>{workflowCounts.live}</strong><small>wymagają uwagi</small></button>
        <button type="button" onClick={() => onFilterChange("finished")}><span>Zakończone</span><strong>{workflowCounts.finished}</strong><small>historia sprzedaży</small></button>
      </div>

      <div className={styles.filterBar} role="group" aria-label="Filtruj aukcje">
        {FILTERS.map((item) => {
          const selected = filter === item.value;
          return (
            <button
              className={selected ? `${styles.filterChip} ${styles.filterChipActive}` : styles.filterChip}
              type="button"
              key={item.value}
              onClick={() => onFilterChange(item.value)}
              aria-pressed={selected}
            >
              {item.label}
              <span>{filterCount(auctions, item.value)}</span>
            </button>
          );
        })}
      </div>

      {filteredAuctions.length > 0 ? (
        <div className={styles.auctionGrid}>
          {filteredAuctions.map((auction) => {
            const active = isAuctionActive(auction.status);
            const archived = auction.recordState === "archived";
            const busy = busyAuctionId === auction.auctionId;
            const scheduleErrorId = `run-start-error-${auction.auctionId}`;

            return (
              <article className={styles.auctionCard} key={auction.auctionId}>
                <div className={styles.auctionCardTop}>
                  <ProductThumb name={auction.productName} imageUrl={auction.productImageUrl} />
                  <div className={styles.auctionIdentity}>
                    <div className={styles.auctionStatusLine}>
                      <div className={styles.statusGroup}>
                        <span className={`${styles.statusPill} ${styles[`status_${auction.recordState === "published" ? auction.status ?? "published" : auction.recordState}`]}`}>
                          {STATUS_LABELS[auction.recordState === "published" ? auction.status ?? "published" : auction.recordState]}
                        </span>
                      </div>
                    </div>
                    <h3>{auction.productName}</h3>
                    <p>{countdownLabel(auction, now)}</p>
                  </div>
                </div>

                <dl className={styles.auctionCardFacts}>
                  <div><dt>Start aukcji</dt><dd>{auction.startsAt ? formatDateTime(auction.startsAt) : "Bez terminu"}</dd></div>
                  <div><dt>Opłacone wejścia</dt><dd>{auction.paidEntryCount ?? "—"}</dd></div>
                  {auction.status === "sold" ? <div><dt>Cena sprzedaży</dt><dd>{formatMoney(auction.currentPrice ?? 0)}</dd></div> : null}
                </dl>
                <div className={styles.auctionCardActions}>
                  {onOrder && auction.status === "sold" && auction.runId ? <button className={styles.secondaryButton} type="button" onClick={() => onOrder(auction.runId!)}>Zamówienie</button> : null}
                  {onDetails && auction.runId ? <button className={styles.secondaryButton} type="button" onClick={() => onDetails(auction.auctionId)}>Szczegóły</button> : null}
                  {auction.runId ? <button className={styles.secondaryButton} type="button" onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(new URL(auctionRunPath(auction.auctionId, auction.runId!), window.location.origin).href);
                      setCopyNotice({ id: auction.auctionId, message: "Link skopiowany." });
                    } catch {
                      setCopyNotice({ id: auction.auctionId, message: "Nie udało się skopiować linku." });
                    }
                  }}>Kopiuj link</button> : null}
                  {copyNotice?.id === auction.auctionId ? <small role="status">{copyNotice.message}</small> : null}
                </div>
                <div className={styles.auctionCardActions}>
                  <button
                    className={styles.secondaryButton}
                    type="button"
                    onClick={() => onEdit(auction)}
                    disabled={busy}
                  >
                    Edytuj
                  </button>
                  <button
                    className={styles.secondaryButton}
                    type="button"
                    onClick={() => onDuplicate(auction)}
                    disabled={busy}
                  >
                    Duplikuj
                  </button>
                  {!active ? <button
                    className={styles.secondaryButton}
                    type="button"
                    onClick={() => onArchiveToggle(auction)}
                    disabled={busy}
                    aria-busy={busy}
                  >
                    {archived ? "Przywróć" : "Archiwizuj"}
                  </button> : null}
                  {auction.recordState === "published" && (auction.status === "waiting" || auction.status === "live") && auction.runId && auction.revision !== null ? (
                    <button className={`${styles.secondaryButton} ${styles.auctionCancelButton}`} type="button" disabled={busy} onClick={() => onCancelRun(auction)}>
                      Anuluj aukcję
                    </button>
                  ) : null}
                  {!auction.runId && !archived && !active ? (
                    <button
                      className={styles.cardPrimaryButton}
                      type="button"
                      onClick={() => openSchedule(auction.auctionId)}
                      disabled={busy}
                      aria-busy={busy}
                    >
                      {busy ? "PRACUJĘ…" : "ZAPLANUJ AUKCJĘ"}
                    </button>
                  ) : null}
                </div>

                {schedulingId === auction.auctionId ? (
                  <form
                    className={styles.runScheduleForm}
                    onSubmit={(event) => {
                      event.preventDefault();
                      scheduleRun(auction);
                    }}
                  >
                    <label className={styles.field} htmlFor={`run-start-${auction.auctionId}`}>
                      <span>Data i godzina rozpoczęcia aukcji</span>
                      <input
                        id={`run-start-${auction.auctionId}`}
                        className={styles.input}
                        type="datetime-local"
                        value={scheduledStart}
                        aria-describedby={scheduleError ? scheduleErrorId : undefined}
                        onChange={(event) => {
                          setScheduledStart(event.target.value);
                          setScheduleError("");
                        }}
                        required
                      />
                    </label>
                    {scheduleError ? <p className={styles.errorNotice} id={scheduleErrorId} role="alert">{scheduleError}</p> : null}
                    <div className={styles.cardActions}>
                      <button className={styles.ghostButton} type="button" onClick={() => setSchedulingId(null)}>
                        Anuluj
                      </button>
                      <button className={styles.cardPrimaryButton} type="submit">
                        POTWIERDŹ TERMIN
                      </button>
                    </div>
                  </form>
                ) : null}

              </article>
            );
          })}
        </div>
      ) : (
        <div className={styles.emptyState}>
          <strong>Brak aukcji w tym widoku</strong>
          <span>Zmień filtr lub wyszukiwanie albo utwórz nową aukcję poniżej.</span>
        </div>
      )}
    </section>
  );
}
