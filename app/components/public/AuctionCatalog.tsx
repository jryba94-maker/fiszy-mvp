"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AuctionCard } from "./AuctionCard";
import {
  fetchAuctionIndex,
  fetchLegacyAuction,
  LEGACY_AUCTION_ID,
  type PublicAuction,
} from "./auction-data";
import { latestPendingReturn } from "./device-history";
import { PublicHeader } from "./PublicHeader";
import styles from "./catalog.module.css";

type CatalogState = {
  auctions: PublicAuction[];
  nextCursor: string | null;
  fallback: boolean;
};

function redirectStripeReturn() {
  const query = new URLSearchParams(window.location.search);
  const kind = query.has("payment") ? "payment" : query.has("purchase") ? "purchase" : null;
  if (!kind) return false;

  const value = query.get(kind);
  if (!value) return false;
  const record = latestPendingReturn(kind);
  const href = record?.href ?? `/aukcje/${LEGACY_AUCTION_ID}`;
  window.location.replace(`${href}?${kind}=${encodeURIComponent(value)}`);
  return true;
}

export function AuctionCatalog() {
  const [catalog, setCatalog] = useState<CatalogState | null>(null);
  const [error, setError] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);

  const loadInitial = useCallback(async (signal?: AbortSignal) => {
    setError("");
    try {
      const result = await fetchAuctionIndex(null, signal);
      if (result.auctions.length) {
        setCatalog({ ...result, fallback: false });
        return;
      }

      const legacy = await fetchLegacyAuction(signal);
      setCatalog({ auctions: [legacy], nextCursor: null, fallback: true });
      return;
    } catch (indexError) {
      if (signal?.aborted) return;
      try {
        const legacy = await fetchLegacyAuction(signal);
        setCatalog({ auctions: [legacy], nextCursor: null, fallback: true });
        return;
      } catch {
        if (signal?.aborted) return;
        setCatalog({ auctions: [], nextCursor: null, fallback: false });
        setError(
          indexError instanceof Error
            ? indexError.message
            : "Nie udało się pobrać katalogu aukcji.",
        );
      }
    }
  }, []);

  useEffect(() => {
    if (redirectStripeReturn()) return;

    const controller = new AbortController();
    void loadInitial(controller.signal);
    const timer = window.setInterval(() => void loadInitial(controller.signal), 10_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [loadInitial]);

  const loadMore = async () => {
    if (!catalog?.nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await fetchAuctionIndex(catalog.nextCursor);
      setCatalog((current) => current
        ? {
            auctions: [
              ...current.auctions,
              ...result.auctions.filter(
                (auction) => !current.auctions.some((item) => item.auctionId === auction.auctionId),
              ),
            ],
            nextCursor: result.nextCursor,
            fallback: false,
          }
        : { ...result, fallback: false });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Nie udało się pobrać kolejnych aukcji.");
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <main className={styles.page}>
      <PublicHeader />

      <section className={styles.hero} aria-labelledby="hero-title">
        <div className={styles.heroInner}>
          <div>
            <p className={styles.eyebrow}>Aukcje z malejącą ceną</p>
            <h1 id="hero-title">Cena spada.<span>Ty wybierasz moment.</span></h1>
          </div>
          <div className={styles.heroAside}>
            <p>
              Obserwujesz cenę na żywo. Klikasz raz. Jeśli jesteś pierwszy —
              ta cena zostaje Twoja.
            </p>
            <div className={styles.heroActions}>
              <Link className={styles.heroAction} href="#aukcje">Zobacz aukcje</Link>
              <Link className={styles.heroActionGhost} href="/moje-fiszy">Moja historia</Link>
            </div>
          </div>
        </div>
      </section>

      <div className={styles.stats} aria-label="Najważniejsze zasady Fiszy">
        <div className={styles.stat}><strong>5 zł</strong><span>wejście do wybranej aukcji</span></div>
        <div className={styles.stat}><strong>1 klik</strong><span>decyduje o zwycięstwie</span></div>
        <div className={styles.stat}><strong>Na żywo</strong><span>czas zsynchronizowany z serwerem</span></div>
      </div>

      <section className={styles.section} id="aukcje" aria-labelledby="auctions-title">
        <div className={styles.sectionHeading}>
          <h2 id="auctions-title">Wybierz swoją Fiszę</h2>
          <p>Każda aukcja ma własny czas, cenę i jedno zwycięskie kliknięcie.</p>
        </div>

        {catalog?.fallback ? (
          <p className={styles.notice} role="status">
            Katalog jest jeszcze podłączany. Pokazujemy dostępną aukcję testową — jej mechanika działa normalnie.
          </p>
        ) : null}

        {!catalog ? (
          <div className={styles.loadingGrid} role="status" aria-label="Ładowanie aukcji" aria-busy="true">
            <span className={styles.srOnly}>Pobieram aktualne aukcje…</span>
            <div className={styles.skeleton} aria-hidden="true" />
            <div className={styles.skeleton} aria-hidden="true" />
            <div className={styles.skeleton} aria-hidden="true" />
          </div>
        ) : (
          <div className={styles.auctionGrid}>
            {catalog.auctions.map((auction) => (
              <AuctionCard key={`${auction.auctionId}:${auction.runId}`} auction={auction} />
            ))}
            {!catalog.auctions.length && !error ? (
              <p className={styles.emptyBox}>Nie ma teraz aktywnych aukcji. Wróć za chwilę.</p>
            ) : null}
            {error ? (
              <div className={styles.errorBox} role="alert">
                <p>{error}</p>
                <button className={styles.retryButton} type="button" onClick={() => void loadInitial()}>
                  Spróbuj ponownie
                </button>
              </div>
            ) : null}
          </div>
        )}

        {catalog?.nextCursor ? (
          <button
            className={styles.moreButton}
            type="button"
            disabled={loadingMore}
            aria-busy={loadingMore}
            onClick={() => void loadMore()}
          >
            {loadingMore ? "Pobieram…" : "Pokaż więcej aukcji"}
          </button>
        ) : null}
      </section>

      <section className={`${styles.section} ${styles.mechanics}`} id="jak-to-dziala" aria-labelledby="mechanics-title">
        <div className={styles.sectionHeading}>
          <h2 id="mechanics-title">Proste zasady. Prawdziwe emocje.</h2>
        </div>
        <div className={styles.steps}>
          <article className={styles.step}>
            <span className={styles.stepNumber}>1</span>
            <h3>Wchodzisz</h3>
            <p>Opłacasz wejście tylko do aukcji, którą naprawdę chcesz obserwować.</p>
          </article>
          <article className={styles.step}>
            <span className={styles.stepNumber}>2</span>
            <h3>Czekasz</h3>
            <p>Cena spada, a Ty decydujesz, czy warto zaryzykować jeszcze chwilę.</p>
          </article>
          <article className={styles.step}>
            <span className={styles.stepNumber}>3</span>
            <h3>Klikasz</h3>
            <p>Pierwszy poprawny klik rezerwuje produkt dokładnie po widocznej cenie.</p>
          </article>
        </div>
      </section>

      <footer className={styles.footer}>
        <span>Fiszy — aukcje, w których cena spada.</span>
        <span>Wersja MVP · płatności obsługuje Stripe</span>
      </footer>
    </main>
  );
}
