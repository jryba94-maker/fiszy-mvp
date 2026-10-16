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

export function AuctionCatalog() {
  const { isLoaded: authLoaded, isSignedIn } = useUser();
  const [catalog, setCatalog] = useState<CatalogState | null>(null);
  const [error, setError] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
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
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") void loadInitial(controller.signal);
    };
    const timer = window.setInterval(refreshIfVisible, 10_000);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshIfVisible);
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

  const auctions = catalog?.auctions ?? [];

  return (
    <main className={styles.page}>
      <PublicHeader />

      <section className={styles.launchIntro} aria-labelledby="hero-title">
        <p className={styles.eyebrow}>Pierwsza aukcja Fiszy</p>
        <h1 id="hero-title">Cena spada. Ty wybierasz moment.</h1>
      </section>

      <section className={styles.launchAuctions} id="aukcje" aria-label="Pierwsza aukcja Fiszy">
        {catalog?.fallback ? (
          <p className={styles.notice} role="status">
            Katalog jest jeszcze podłączany. Pokazujemy dostępną aukcję testową — jej mechanika działa normalnie.
          </p>
        ) : null}

        {!catalog ? (
          <div className={styles.loadingGrid} role="status" aria-label="Ładowanie aukcji" aria-busy="true">
            <span className={styles.srOnly}>Pobieram aktualne aukcje…</span>
            <div className={styles.skeleton} aria-hidden="true" />
          </div>
        ) : (
          <div className={styles.auctionGrid}>
            {auctions.map((auction) => (
              <AuctionCard
                key={`${auction.auctionId}:${auction.runId}`}
                auction={auction}
                watched={watchedIds.has(auction.auctionId)}
                watchBusy={watchBusyId === auction.auctionId}
                onWatchToggle={toggleWatch}
              />
            ))}
            {!auctions.length && !error ? (
              <div className={styles.emptyBox}>
                <p>Nie ma teraz aktywnej aukcji.</p>
                <span>Szczegóły pierwszej aukcji pojawią się tutaj.</span>
              </div>
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
          <h2 id="mechanics-title">Moment decyzji</h2>
        </div>
        <article className={styles.mechanicsCard}>
          <div className={styles.mechanicsLead}>
            <h3>Cena spada.<br />Ty obserwujesz.</h3>
          </div>
          <div className={styles.mechanicsCopy}>
            <p>Im dłużej czekasz, tym mniej możesz zapłacić.</p>
            <p><strong>Tylko jednego nie wiesz:</strong><br />kiedy zdecyduje ktoś inny.</p>
            <p>Gdy cena jest właściwa, klikasz.<br />Pierwsza decyzja kończy aukcję.</p>
          </div>
        </article>
      </section>

      <footer className={styles.footer}>
        <span><strong>Fiszy.</strong> Przywracamy emocje zakupów.</span>
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
