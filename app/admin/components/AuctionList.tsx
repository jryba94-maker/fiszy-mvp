"use client";

import { useEffect, useMemo, useState } from "react";
import type { AdminAuction, AuctionFilter } from "../types";
import {
  STATUS_LABELS,
  countdownLabel,
  formatDateTime,
  formatMoney,
  isAuctionActive,
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
];

type AuctionListProps = {
  auctions: AdminAuction[];
  filter: AuctionFilter;
  busyAuctionId: string | null;
  onFilterChange: (filter: AuctionFilter) => void;
  onEdit: (auction: AdminAuction) => void;
  onStart: (auction: AdminAuction) => void;
};

function filterCount(auctions: AdminAuction[], filter: AuctionFilter) {
  return auctions.filter((auction) => matchesFilter(auction, filter)).length;
}

export function AuctionList({
  auctions,
  filter,
  busyAuctionId,
  onFilterChange,
  onEdit,
  onStart,
}: AuctionListProps) {
  const [now, setNow] = useState(() => Date.now());
  const hasTimedAuction = auctions.some(
    (auction) => auction.status === "waiting" || auction.status === "live",
  );

  useEffect(() => {
    if (!hasTimedAuction) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [hasTimedAuction]);

  const filteredAuctions = useMemo(
    () => sortAuctions(auctions).filter((auction) => matchesFilter(auction, filter)),
    [auctions, filter],
  );

  return (
    <section className={styles.panelSection} aria-labelledby="auctions-heading">
      <div className={styles.sectionHeader}>
        <div>
          <p className={styles.eyebrow}>Katalog</p>
          <h2 id="auctions-heading">Wszystkie aukcje</h2>
        </div>
        <span className={styles.sectionCount}>{auctions.length}</span>
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
            const starting = busyAuctionId === auction.auctionId;

            return (
              <article className={styles.auctionCard} key={auction.auctionId}>
                <div className={styles.auctionCardTop}>
                  <ProductThumb name={auction.productName} imageUrl={auction.productImageUrl} />
                  <div className={styles.auctionIdentity}>
                    <div className={styles.auctionStatusLine}>
                      <span className={`${styles.statusPill} ${styles[`status_${auction.status}`]}`}>
                        <span aria-hidden="true" />
                        {STATUS_LABELS[auction.status]}
                      </span>
                      <span className={styles.slug}>/{auction.slug}</span>
                    </div>
                    <h3>{auction.productName}</h3>
                    <p>{countdownLabel(auction, now)}</p>
                  </div>
                </div>

                <dl className={styles.auctionStats}>
                  <div>
                    <dt>Zakres ceny</dt>
                    <dd>{formatMoney(auction.startPrice)} → {formatMoney(auction.floorPrice)}</dd>
                  </div>
                  <div>
                    <dt>Aktualna</dt>
                    <dd>{auction.currentPrice !== null ? formatMoney(auction.currentPrice) : "—"}</dd>
                  </div>
                  <div>
                    <dt>Czas</dt>
                    <dd>{auction.durationMinutes || "—"} min</dd>
                  </div>
                  <div>
                    <dt>Start</dt>
                    <dd>{formatDateTime(auction.startsAt)}</dd>
                  </div>
                </dl>

                <div className={styles.cardActions}>
                  <button
                    className={styles.secondaryButton}
                    type="button"
                    onClick={() => onEdit(auction)}
                    disabled={starting}
                  >
                    Edytuj
                  </button>
                  <button
                    className={styles.cardPrimaryButton}
                    type="button"
                    onClick={() => onStart(auction)}
                    disabled={active || starting}
                    aria-busy={starting}
                    aria-describedby={active ? `active-reason-${auction.auctionId}` : undefined}
                  >
                    {starting
                      ? "URUCHAMIAM…"
                      : auction.status === "draft"
                        ? "URUCHOM PIERWSZĄ RUNDĘ"
                        : "URUCHOM KOLEJNĄ RUNDĘ"}
                  </button>
                </div>

                {active ? (
                  <p className={styles.disabledReason} id={`active-reason-${auction.auctionId}`}>
                    Nową rundę uruchomisz po zakończeniu bieżącej.
                  </p>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : (
        <div className={styles.emptyState}>
          <strong>Brak aukcji w tym widoku</strong>
          <span>Zmień filtr albo utwórz nową aukcję poniżej.</span>
        </div>
      )}
    </section>
  );
}
