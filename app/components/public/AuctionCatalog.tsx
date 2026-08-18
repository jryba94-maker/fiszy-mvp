"use client";

import { useUser } from "@clerk/nextjs";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AuctionCard } from "./AuctionCard";
import {
  fetchAuctionIndex,
  fetchLegacyAuction,
  LEGACY_AUCTION_ID,
  type PublicAuction,
} from "./auction-data";
import { latestPendingReturn } from "./device-history";
import { announceWatchlistChange } from "../pwa/browser-notifications";
import { PublicHeader } from "./PublicHeader";
import styles from "./catalog.module.css";

type CatalogState = {
  auctions: PublicAuction[];
  nextCursor: string | null;
  fallback: boolean;
  hasLoadedMore: boolean;
};

function uniqueAuctions(
  primary: PublicAuction[],
  secondary: PublicAuction[] = [],
) {
  const seen = new Set<string>();
  const now = Date.now();
  return [...primary, ...secondary].filter((auction) => {
    if (
      (auction.status !== "waiting" && auction.status !== "live") ||
      Date.parse(auction.endsAt) <= now
    ) {
      return false;
    }
    if (seen.has(auction.auctionId)) return false;
    seen.add(auction.auctionId);
    return true;
  });
}

function refreshedCatalog(
  current: CatalogState | null,
  firstPage: PublicAuction[],
  firstPageNextCursor: string | null,
  fallback: boolean,
): CatalogState {
  if (!current?.hasLoadedMore) {
    return {
      auctions: uniqueAuctions(firstPage),
      nextCursor: firstPageNextCursor,
      fallback,
      hasLoadedMore: false,
    };
  }

  return {
    // The refreshed first page wins for matching IDs, while every auction the
    // user has already loaded remains visible if it moved to a later page.
    auctions: uniqueAuctions(firstPage, current.auctions),
    // Once another page has been loaded, its cursor is the tail of the list.
    // A first-page poll must not move that tail back to page one.
    nextCursor: current.nextCursor,
    fallback,
    hasLoadedMore: true,
  };
}

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

function resultCountLabel(count: number) {
  if (count === 1) return "1 wynik";
  const lastTwoDigits = count % 100;
  const lastDigit = count % 10;
  return `${count} ${lastDigit >= 2 && lastDigit <= 4 && (lastTwoDigits < 12 || lastTwoDigits > 14) ? "wyniki" : "wyników"}`;
}

export function AuctionCatalog() {
  const { isLoaded: authLoaded, isSignedIn } = useUser();
  const [catalog, setCatalog] = useState<CatalogState | null>(null);
  const [error, setError] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [watchedIds, setWatchedIds] = useState<Set<string>>(() => new Set());
  const [watchBusyId, setWatchBusyId] = useState<string | null>(null);
  const firstPageRequestRef = useRef(0);
  const loadingMoreRef = useRef(false);

  const loadInitial = useCallback(async (signal?: AbortSignal) => {
    const requestId = ++firstPageRequestRef.current;
    const isCurrentRequest = () =>
      !signal?.aborted && requestId === firstPageRequestRef.current;
    setError("");
    try {
      const result = await fetchAuctionIndex(null, signal);
      if (!isCurrentRequest()) return;
      setCatalog((current) => refreshedCatalog(
        current,
        result.auctions,
        result.nextCursor,
        false,
      ));
      return;
    } catch (indexError) {
      if (!isCurrentRequest()) return;
      try {
        const legacy = await fetchLegacyAuction(signal);
        if (!isCurrentRequest()) return;
        setCatalog((current) => refreshedCatalog(
          current,
          [legacy],
          null,
          true,
        ));
        return;
      } catch {
        if (!isCurrentRequest()) return;
        setCatalog((current) => current ?? refreshedCatalog(
          null,
          [],
          null,
          false,
        ));
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

  useEffect(() => {
    if (!authLoaded) return;
    if (!isSignedIn) { setWatchedIds(new Set()); return; }
    const controller = new AbortController();
    fetch("/api/account/watchlist", { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("watchlist")))
      .then((data: { auctionIds?: string[] }) => setWatchedIds(new Set(data.auctionIds ?? [])))
      .catch(() => undefined);
    return () => controller.abort();
  }, [authLoaded, isSignedIn]);

  const loadMore = async () => {
    const cursor = catalog?.nextCursor;
    if (!cursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const result = await fetchAuctionIndex(cursor);
      setCatalog((current) => current
        ? {
            auctions: uniqueAuctions(current.auctions, result.auctions),
            nextCursor: result.nextCursor,
            fallback: false,
            hasLoadedMore: true,
          }
        : refreshedCatalog(
            null,
            result.auctions,
            result.nextCursor,
            false,
          ));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Nie udało się pobrać kolejnych aukcji.");
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  };

  const toggleWatch = async (auctionId: string, watched: boolean) => {
    if (watchBusyId) return;
    const previous = watchedIds;
    setWatchBusyId(auctionId);
    setWatchedIds((current) => {
      const next = new Set(current);
      if (watched) next.add(auctionId); else next.delete(auctionId);
      return next;
    });
    try {
      const response = await fetch("/api/account/watchlist", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auctionId, watched }),
      });
      if (!response.ok) throw new Error("watchlist");
      announceWatchlistChange();
    } catch {
      setWatchedIds(previous);
      setError("Nie udało się zmienić obserwowanych aukcji.");
    } finally {
      setWatchBusyId(null);
    }
  };

  const filteredAuctions = (catalog?.auctions ?? []).filter((auction) => {
    const query = searchQuery.trim().toLocaleLowerCase("pl-PL");
    const matchesSearch = !query || auction.product.toLocaleLowerCase("pl-PL").includes(query);
    const matchesStatus = statusFilter === "all" ||
      (statusFilter === "available" && (auction.status === "waiting" || auction.status === "live")) ||
      (statusFilter === "live" && auction.status === "live") ||
      (statusFilter === "finished" && ["ended", "sold", "payment_pending"].includes(auction.status));
    const matchesCategory = categoryFilter === "all" || auction.category === categoryFilter;
    return matchesSearch && matchesStatus && matchesCategory;
  });

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

      <div className={styles.stats} role="group" aria-label="Najważniejsze zasady Fiszy">
        <div className={styles.stat}><strong>Ustalane</strong><span>wejście do wybranej aukcji</span></div>
        <div className={styles.stat}><strong>1 klik</strong><span>decyduje o zwycięstwie</span></div>
        <div className={styles.stat}><strong>Na żywo</strong><span>czas zsynchronizowany z serwerem</span></div>
      </div>

      <section className={styles.section} id="aukcje" aria-labelledby="auctions-title">
        <div className={styles.sectionHeading}>
          <h2 id="auctions-title">Wybierz swoją Fiszę</h2>
          <p>Każda aukcja ma własny czas, cenę i jedno zwycięskie kliknięcie.</p>
        </div>

        <div className={styles.catalogTools} role="search" aria-label="Wyszukiwanie i filtrowanie aukcji">
          <label className={styles.searchField}>
            <span className={styles.srOnly}>Szukaj produktu</span>
            <input type="search" value={searchQuery} placeholder="Szukaj produktu…" onChange={(event) => setSearchQuery(event.target.value)} />
          </label>
          <label>
            <span className={styles.srOnly}>Status aukcji</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">Wszystkie statusy</option>
              <option value="available">Dostępne</option>
              <option value="live">Trwają teraz</option>
              <option value="finished">Zakończone</option>
            </select>
          </label>
          <label>
            <span className={styles.srOnly}>Kategoria produktu</span>
            <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
              <option value="all">Wszystkie kategorie</option>
              <option value="electronics">Elektronika</option>
              <option value="home">Dom</option>
              <option value="sport">Sport</option>
              <option value="beauty">Uroda</option>
              <option value="gaming">Gaming</option>
              <option value="other">Pozostałe</option>
            </select>
          </label>
          <span className={styles.resultsCount} aria-live="polite">{resultCountLabel(filteredAuctions.length)}</span>
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
            {filteredAuctions.map((auction) => (
              <AuctionCard
                key={`${auction.auctionId}:${auction.runId}`}
                auction={auction}
                watched={watchedIds.has(auction.auctionId)}
                watchBusy={watchBusyId === auction.auctionId}
                onWatchToggle={toggleWatch}
              />
            ))}
            {!filteredAuctions.length && !error ? (
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
        <nav className={styles.footerLinks} aria-label="Dokumenty">
          <Link href="/regulamin">Regulamin</Link>
          <Link href="/prywatnosc">Prywatność</Link>
          <Link href="/cookies">Cookies</Link>
          <Link href="/reklamacje">Reklamacje</Link>
          <Link href="/faq">FAQ</Link>
        </nav>
      </footer>
    </main>
  );
}
