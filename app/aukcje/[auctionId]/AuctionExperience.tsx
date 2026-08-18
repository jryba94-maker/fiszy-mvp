"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  cancelPurchase,
  claimAuction,
  auctionCategoryLabel,
  fetchAuctionDetail,
  fetchEntryState,
  PublicApiError,
  startEntryCheckout,
  type AuctionStatus,
  type PublicAuction,
} from "../../components/public/auction-data";
import { recordAuctionEvent, refreshRecordedAuction } from "../../components/public/device-history";
import { PublicHeader } from "../../components/public/PublicHeader";
import { SafeAuctionImage } from "../../components/public/SafeAuctionImage";
import { StatusBadge } from "../../components/public/StatusBadge";
import { AuctionWatchControl } from "../../components/public/AuctionWatchControl";
import styles from "./page.module.css";

type Feedback = { text: string; error?: boolean } | null;
const ENTRY_WINDOW_MS = 60_000;

function clearQueryParam(name: string) {
  const url = new URL(window.location.href);
  url.searchParams.delete(name);
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

function statusAt(auction: PublicAuction, serverNow: number): AuctionStatus {
  if (auction.status === "waiting" && serverNow >= Date.parse(auction.startsAt)) {
    return serverNow < Date.parse(auction.endsAt) ? "live" : "ended";
  }
  if (auction.status === "live" && serverNow >= Date.parse(auction.endsAt)) {
    return "ended";
  }
  return auction.status;
}

function priceAt(auction: PublicAuction, status: AuctionStatus, serverNow: number) {
  if (status === "waiting") return auction.startPrice;
  if (status === "ended") return auction.floorPrice;
  if (status !== "live") return auction.currentPrice;

  const start = Date.parse(auction.startsAt);
  const end = Date.parse(auction.endsAt);
  const duration = end - start;
  if (duration <= 0) return auction.floorPrice;
  const totalDrops = auction.startPrice - auction.floorPrice;
  const totalPricePoints = totalDrops + 1;
  const floorWindow = Math.min(
    duration,
    Math.max(1_000, duration / totalPricePoints),
  );
  const fallingDuration = duration - floorWindow;
  const elapsed = Math.max(0, serverNow - start);
  if (fallingDuration <= 0 || elapsed >= fallingDuration) {
    return auction.floorPrice;
  }
  const completedDrops = Math.floor(
    (elapsed * totalDrops) / fallingDuration,
  );
  return Math.max(auction.floorPrice, auction.startPrice - completedDrops);
}

function formatCountdown(target: string | null, serverNow: number) {
  if (!target) return "—";
  const totalSeconds = Math.max(0, Math.ceil((Date.parse(target) - serverNow) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function startDateLabel(value: string) {
  return new Intl.DateTimeFormat("pl-PL", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function timerAt(
  auction: PublicAuction | null,
  displayStatus: AuctionStatus,
  serverNow: number,
) {
  if (!auction) return { label: "Ładowanie", value: "—" };
  if (displayStatus === "waiting") {
    return { label: "Do startu", value: formatCountdown(auction.startsAt, serverNow) };
  }
  if (displayStatus === "live") {
    return { label: "Do końca", value: formatCountdown(auction.endsAt, serverNow) };
  }
  if (displayStatus === "payment_pending") {
    return {
      label: "Na płatność zwycięzcy",
      value: formatCountdown(auction.paymentExpiresAt, serverNow),
    };
  }
  return {
    label: displayStatus === "sold" ? "Aukcja zamknięta" : "Czas minął",
    value: "00:00",
  };
}

function outcomeMessage(outcome: string, action: "entry" | "buy") {
  if (outcome === "stripe_not_configured") {
    return "Płatności nie są jeszcze skonfigurowane w tym środowisku.";
  }
  if (outcome === "storage_error") {
    return "Mechanizm aukcji jest chwilowo niedostępny. Spróbuj ponownie za moment.";
  }
  if (outcome === "rate_limited") {
    return "Wykonano zbyt wiele prób płatności. Odczekaj chwilę i spróbuj ponownie.";
  }
  if (outcome === "run_changed") {
    return "Wystartowała nowa edycja tej aukcji. Odświeżamy jej dane.";
  }
  if (outcome === "auction_unavailable" || outcome === "not_live") {
    return action === "entry"
      ? "Do tej edycji nie można już wykupić wejścia."
      : "Aukcja nie jest już aktywna.";
  }
  return action === "entry"
    ? "Nie udało się rozpocząć płatności za wejście. Spróbuj ponownie."
    : "Nie udało się rozpocząć płatności za produkt. Spróbuj ponownie.";
}

export function AuctionExperience({ auctionId }: { auctionId: string }) {
  const [auction, setAuction] = useState<PublicAuction | null>(null);
  const [serverOffset, setServerOffset] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  const [loadError, setLoadError] = useState("");
  const [notFound, setNotFound] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [hasEntry, setHasEntry] = useState(false);
  const [entryRunId, setEntryRunId] = useState<string | null>(null);
  const [isEntering, setIsEntering] = useState(false);
  const [isBuying, setIsBuying] = useState(false);
  const [entryFeedback, setEntryFeedback] = useState<Feedback>(null);
  const [purchaseFeedback, setPurchaseFeedback] = useState<Feedback>(null);
  const { isLoaded: isAuthLoaded, isSignedIn } = useAuth();
  const cancelAttemptRef = useRef<string | null>(null);
  const pollingDelay = auction?.status === "sold" || auction?.status === "ended" ? 15_000 : 1_000;

  useEffect(() => {
    let active = true;
    let hasLoaded = false;
    let requestInFlight = false;
    const controller = new AbortController();

    const load = async () => {
      if (requestInFlight) return;
      requestInFlight = true;
      const requestStartedAt = Date.now();
      try {
        const next = await fetchAuctionDetail(auctionId, controller.signal);
        if (!active) return;
        const requestFinishedAt = Date.now();
        const requestMidpoint = Math.round((requestStartedAt + requestFinishedAt) / 2);
        setServerOffset(Date.parse(next.serverTime) - requestMidpoint);
        setAuction(next);
        setLoadError("");
        setNotFound(false);
        refreshRecordedAuction(next);
        hasLoaded = true;
      } catch (error) {
        if (controller.signal.aborted) return;
        if (!active || hasLoaded) return;
        if (error instanceof PublicApiError && error.status === 404) {
          setNotFound(true);
          setLoadError("");
        } else {
          setLoadError(error instanceof Error ? error.message : "Nie udało się pobrać aukcji.");
        }
      } finally {
        requestInFlight = false;
      }
    };

    void load();
    const poller = window.setInterval(() => void load(), pollingDelay);
    return () => {
      active = false;
      controller.abort();
      window.clearInterval(poller);
    };
  }, [auctionId, pollingDelay, reloadKey]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!auction?.runId || !isAuthLoaded || !isSignedIn) {
      setHasEntry(false);
      setEntryRunId(null);
      return;
    }

    let active = true;
    let retryTimer: number | undefined;
    let attempts = 0;
    const runId = auction.runId;
    const paymentState = new URLSearchParams(window.location.search).get("payment");

    setHasEntry(false);
    setEntryRunId(runId);

    if (paymentState === "success") {
      setEntryFeedback({ text: "Płatność zakończona. Czekamy na potwierdzenie Stripe…" });
    } else if (paymentState === "cancelled") {
      setEntryFeedback({ text: "Płatność została anulowana. Wejście nie zostało aktywowane." });
      recordAuctionEvent(auction, { entryState: "cancelled" });
      clearQueryParam("payment");
    } else {
      setEntryFeedback(null);
    }

    const checkEntry = async (): Promise<boolean> => {
      try {
        const data = await fetchEntryState(auctionId, runId);
        if (!active) return false;

        const granted = Boolean(data.outcome === "ok" && data.hasEntry && data.runId === runId);
        setHasEntry(granted);
        setEntryRunId(data.runId ?? runId);
        if (granted) {
          recordAuctionEvent(auction, { entryState: "active" });
          if (paymentState === "success") {
            setEntryFeedback({ text: "Płatność potwierdzona. Masz dostęp do tej aukcji." });
            clearQueryParam("payment");
          }
        }
        return granted;
      } catch {
        return false;
      }
    };

    const checkWithRetry = async () => {
      const granted = await checkEntry();
      if (!active || granted || paymentState !== "success") return;
      attempts += 1;
      if (attempts >= 15) {
        recordAuctionEvent(auction, { entryState: "unconfirmed" });
        setEntryFeedback({
          text: `Wejście nie zostało jeszcze przyznane. Jeśli aukcja rozpoczęła się podczas płatności, ${auction.entryFee} zł zostanie automatycznie zwrócone.`,
          error: true,
        });
        clearQueryParam("payment");
        return;
      }
      retryTimer = window.setTimeout(() => void checkWithRetry(), 800);
    };

    void checkWithRetry();
    return () => {
      active = false;
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [auction?.entryFee, auction?.runId, auctionId, isAuthLoaded, isSignedIn]);

  useEffect(() => {
    if (!auction?.runId || !isAuthLoaded || !isSignedIn) return;
    const purchaseState = new URLSearchParams(window.location.search).get("purchase");
    if (!purchaseState) return;

    if (purchaseState === "success") {
      if (auction.status === "sold") {
        setPurchaseFeedback({ text: "Płatność potwierdzona. Produkt jest Twój." });
        recordAuctionEvent(auction, { purchaseState: "paid" });
        clearQueryParam("purchase");
      } else {
        setPurchaseFeedback({ text: "Płatność zakończona. Czekamy na potwierdzenie Stripe…" });
      }
      return;
    }

    if (purchaseState !== "cancelled") return;
    const attemptKey = `${auction.auctionId}:${auction.runId}`;
    if (cancelAttemptRef.current === attemptKey) return;
    cancelAttemptRef.current = attemptKey;

    let active = true;
    setPurchaseFeedback({ text: "Bezpiecznie zwalniamy rezerwację…" });
    const run = async () => {
      try {
        const data = await cancelPurchase(auction.auctionId, auction.runId);
        if (!active) return;
        if (data.outcome === "cancelled" || data.outcome === "nothing_to_cancel") {
          setPurchaseFeedback({ text: "Płatność została anulowana. Zakup nie został opłacony." });
          recordAuctionEvent(auction, { purchaseState: "cancelled" });
          clearQueryParam("purchase");
        } else if (data.outcome === "already_paid") {
          setPurchaseFeedback({ text: "Płatność została już potwierdzona. Produkt jest Twój." });
          recordAuctionEvent(auction, { purchaseState: "paid" });
          clearQueryParam("purchase");
        } else {
          setPurchaseFeedback({
            text: "Nie udało się bezpiecznie zwolnić rezerwacji. Spróbuj ponownie za chwilę.",
            error: true,
          });
        }
      } catch {
        if (active) {
          setPurchaseFeedback({
            text: "Nie udało się bezpiecznie zwolnić rezerwacji. Spróbuj ponownie za chwilę.",
            error: true,
          });
        }
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [auction?.auctionId, auction?.runId, auction?.status, isAuthLoaded, isSignedIn]);

  const serverNow = clock + serverOffset;
  const displayStatus = auction ? statusAt(auction, serverNow) : "waiting";
  const visiblePrice = auction ? priceAt(auction, displayStatus, serverNow) : 0;
  const hasCurrentEntry = Boolean(auction && hasEntry && entryRunId === auction.runId);
  const startsAtMs = auction ? Date.parse(auction.startsAt) : Number.NaN;
  const entryOpensAtMs = startsAtMs - ENTRY_WINDOW_MS;
  const entryWindowOpen = Boolean(
    auction &&
      displayStatus === "waiting" &&
      serverNow >= entryOpensAtMs &&
      serverNow < startsAtMs,
  );

  const timer = timerAt(auction, displayStatus, serverNow);

  const progress = auction
    ? Math.max(
        0,
        Math.min(100, ((auction.startPrice - visiblePrice) / (auction.startPrice - auction.floorPrice)) * 100),
      )
    : 0;

  let auctionMessage = "";
  if (auction) {
    if (!auction.storageReady) {
      auctionMessage = "Mechanizm zakupu jest chwilowo niedostępny.";
    } else if (displayStatus === "waiting") {
      auctionMessage = entryWindowOpen
        ? `Wejście jest otwarte do startu o ${startDateLabel(auction.startsAt)}.`
        : `Wejście otworzy się minutę przed startem: ${startDateLabel(auction.startsAt)}.`;
    } else if (!isAuthLoaded) {
      auctionMessage = "Sprawdzamy stan Twojego konta…";
    } else if (!isSignedIn && displayStatus === "live") {
      auctionMessage = "Aukcja już trwa. Do tej rundy nie można już dołączyć.";
    } else if (displayStatus === "live" && !hasCurrentEntry) {
      auctionMessage = "Aukcja już trwa. Do tej rundy nie można już dołączyć.";
    } else if (displayStatus === "live") {
      auctionMessage = "Cena spada. Pierwszy poprawny klik rezerwuje widoczną kwotę.";
    } else if (displayStatus === "payment_pending") {
      auctionMessage = `Pierwszy klik zarezerwował produkt za ${visiblePrice} zł. Czekamy na płatność zwycięzcy.`;
    } else if (displayStatus === "sold") {
      auctionMessage = `Produkt został opłacony za ${visiblePrice} zł.`;
    } else {
      auctionMessage = "Aukcja zakończyła się bez aktywnej rezerwacji.";
    }
  }

  const canEnter = Boolean(
    auction &&
      isAuthLoaded &&
      isSignedIn &&
      auction.storageReady &&
      !hasCurrentEntry &&
      entryWindowOpen,
  );
  const canBuy = Boolean(
    auction && isAuthLoaded && isSignedIn && auction.storageReady && hasCurrentEntry && displayStatus === "live",
  );
  const needsSignIn = Boolean(
    auction && isAuthLoaded && !isSignedIn && auction.storageReady &&
      entryWindowOpen,
  );

  let actionLabel = "ŁADOWANIE…";
  if (auction) {
    if (!isAuthLoaded) actionLabel = "SPRAWDZAMY KONTO…";
    else if (needsSignIn) actionLabel = "ZALOGUJ SIĘ, ABY DOŁĄCZYĆ";
    else if (isEntering) actionLabel = "PRZECHODZĘ DO PŁATNOŚCI…";
    else if (isBuying) actionLabel = "REZERWUJĘ…";
    else if (canEnter) actionLabel = `OPŁAĆ WEJŚCIE — ${auction.entryFee} ZŁ`;
    else if (canBuy) actionLabel = `KUP TERAZ — ${visiblePrice} ZŁ`;
    else if (displayStatus === "waiting" && hasCurrentEntry) actionLabel = "WEJŚCIE OPŁACONE — CZEKAMY";
    else if (displayStatus === "waiting") actionLabel = "WEJŚCIE OTWORZY SIĘ MINUTĘ PRZED STARTEM";
    else if (displayStatus === "payment_pending") actionLabel = "PRODUKT ZAREZERWOWANY";
    else if (displayStatus === "sold") actionLabel = "SPRZEDANE";
    else actionLabel = "AUKCJA ZAKOŃCZONA";
  }
  const actionDisabled = !isAuthLoaded || isEntering || isBuying || (!canEnter && !canBuy && !needsSignIn);

  const handleEntry = async () => {
    if (!auction || !canEnter || isEntering) return;
    setIsEntering(true);
    setEntryFeedback(null);
    try {
      const data = await startEntryCheckout(auction.auctionId, auction.runId);
      if (data.outcome === "checkout" && data.checkoutUrl) {
        recordAuctionEvent(auction, { entryState: "checkout" });
        window.location.assign(data.checkoutUrl);
        return;
      }
      if (data.outcome === "already_granted" && data.runId === auction.runId) {
        setHasEntry(true);
        setEntryRunId(data.runId);
        recordAuctionEvent(auction, { entryState: "active" });
        setEntryFeedback({ text: "Masz już opłacone wejście do tej aukcji." });
        return;
      }
      setEntryFeedback({ text: outcomeMessage(data.outcome, "entry"), error: true });
    } catch {
      setEntryFeedback({ text: outcomeMessage("payment_error", "entry"), error: true });
    } finally {
      setIsEntering(false);
    }
  };

  const handleBuy = async () => {
    if (!auction || !canBuy || isBuying) return;
    setIsBuying(true);
    setPurchaseFeedback(null);
    try {
      const data = await claimAuction(
        auction.auctionId,
        auction.runId,
        visiblePrice,
      );
      if (data.outcome === "checkout" && data.checkoutUrl) {
        recordAuctionEvent({ ...auction, currentPrice: visiblePrice }, {
          purchaseState: "checkout",
          reservedPrice: data.price ?? visiblePrice,
        });
        window.location.assign(data.checkoutUrl);
        return;
      }
      if (data.outcome === "lost") {
        const winnerPrice = data.winnerPrice ?? visiblePrice;
        setAuction((current) => current
          ? { ...current, status: "payment_pending", currentPrice: winnerPrice }
          : current);
        recordAuctionEvent({ ...auction, status: "payment_pending", currentPrice: winnerPrice }, {
          purchaseState: "lost",
        });
        setPurchaseFeedback({
          text: "Ktoś kliknął wcześniej. Produkt został zarezerwowany dla zwycięzcy.",
          error: true,
        });
        return;
      }
      if (data.outcome === "price_changed") {
        const currentPrice = data.currentPrice ?? visiblePrice;
        setAuction((current) => current ? { ...current, currentPrice } : current);
        setPurchaseFeedback({
          text: "Cena właśnie się zmieniła — sprawdź nową kwotę i kliknij ponownie.",
          error: true,
        });
        return;
      }
      if (data.outcome === "entry_required") {
        setHasEntry(false);
        setEntryRunId(auction.runId);
        setEntryFeedback({ text: "Najpierw opłać wejście do tej aukcji.", error: true });
        return;
      }
      setPurchaseFeedback({ text: outcomeMessage(data.outcome, "buy"), error: true });
    } catch {
      setPurchaseFeedback({ text: outcomeMessage("payment_error", "buy"), error: true });
    } finally {
      setIsBuying(false);
    }
  };

  const handleAction = () => {
    if (needsSignIn) {
      const redirectUrl = `${window.location.pathname}${window.location.search}`;
      window.location.assign(`/sign-in?redirect_url=${encodeURIComponent(redirectUrl)}`);
    } else if (canBuy) void handleBuy();
    else if (canEnter) void handleEntry();
  };

  if (!auction) {
    return (
      <main className={styles.page}>
        <PublicHeader />
        <section
          className={styles.stateShell}
          aria-busy={!notFound && !loadError}
          aria-live="polite"
        >
          {notFound || loadError ? (
            <div>
              <h1>{notFound ? "Nie znaleźliśmy tej aukcji" : "Aukcja chwilowo niedostępna"}</h1>
              <p>{notFound ? "Link może być nieaktualny albo aukcja nie została jeszcze opublikowana." : loadError}</p>
              <div className={styles.stateActions}>
                {!notFound ? (
                  <button className={styles.stateButton} type="button" onClick={() => setReloadKey((key) => key + 1)}>
                    Spróbuj ponownie
                  </button>
                ) : null}
                <Link className={styles.stateLink} href="/">Wróć do katalogu</Link>
              </div>
            </div>
          ) : (
            <div aria-live="polite"><h1>Ładujemy aukcję…</h1><p>Pobieramy aktualną cenę i czas prosto z serwera.</p></div>
          )}
        </section>
      </main>
    );
  }

  const actionNote = hasCurrentEntry
    ? "Wejście opłacone dla tej edycji"
    : `Jednorazowe wejście do tej aukcji: ${auction.entryFee} zł`;

  return (
    <main className={styles.page}>
      <PublicHeader />
      <div className={styles.content}>
        <Link className={styles.backLink} href="/"><span aria-hidden="true">←</span> Wszystkie aukcje</Link>

        <section className={styles.auctionShell} aria-labelledby="auction-title">
          <SafeAuctionImage
            src={auction.productImageUrl}
            alt={auction.product}
            priority
            sizes="(max-width: 900px) 100vw, 55vw"
            frameClassName={styles.visual}
          />
          <div className={styles.panel}>
            <div className={styles.topline}>
              <StatusBadge status={displayStatus} />
              <div className={styles.toplineActions}>
                <AuctionWatchControl auctionId={auction.auctionId} />
                <span className={styles.duration}>{auctionCategoryLabel(auction.category)} · {auction.durationMinutes} min</span>
              </div>
            </div>
            <h1 className={styles.title} id="auction-title">{auction.product}</h1>

            <div className={styles.priceArea}>
              <div className={styles.priceTopline}>
                <span className={styles.priceLabel}>Aktualna cena</span>
                <span className={styles.regularPrice}>regularnie {auction.regularPrice} zł</span>
              </div>
              <span className={styles.currentPrice} aria-live="off" aria-label={`Aktualna cena ${visiblePrice} zł`}>
                {visiblePrice} zł
              </span>
              <div
                className={styles.progressTrack}
                role="progressbar"
                aria-label="Postęp spadku ceny"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(progress)}
              >
                <div className={styles.progressBar} style={{ width: `${progress}%` }} />
              </div>
            </div>

            <div className={styles.clockBox}>
              <div>
                <span className={styles.clockLabel}>{timer.label}</span>
                <span className={styles.clock} aria-live="off">{timer.value}</span>
              </div>
              <span className={styles.sync}>Czas zsynchronizowany z serwerem</span>
            </div>

            <p className={styles.message} aria-live="polite">{auctionMessage}</p>
            {auction.postAuctionOffer.enabled ? (
              <p className={styles.offerNote}>
                Jeśli nie wygrasz, po zakończeniu tej edycji otrzymasz na koncie rabat {auction.entryFee} zł na ten sam produkt. Oferta będzie ważna przez {auction.postAuctionOffer.validityDays} dni.
              </p>
            ) : null}
            {!auction.storageReady ? (
              <p className={styles.storageWarning} role="alert">
                Zakup jest zablokowany do czasu przywrócenia bezpiecznego zapisu.
              </p>
            ) : null}
            <div>
              {entryFeedback ? (
                <p
                  className={`${styles.feedback} ${entryFeedback.error ? styles.feedbackError : ""}`}
                  role={entryFeedback.error ? "alert" : "status"}
                >
                  {entryFeedback.text}
                </p>
              ) : null}
              {purchaseFeedback ? (
                <p
                  className={`${styles.feedback} ${purchaseFeedback.error ? styles.feedbackError : ""}`}
                  role={purchaseFeedback.error ? "alert" : "status"}
                >
                  {purchaseFeedback.text}
                </p>
              ) : null}
            </div>

            <div className={`${styles.actionArea} ${styles.desktopAction}`}>
              <button
                className={styles.primaryButton}
                type="button"
                disabled={actionDisabled}
                aria-busy={isEntering || isBuying}
                aria-describedby="desktop-action-note"
                onClick={handleAction}
              >
                {actionLabel}
              </button>
              <p
                className={`${styles.entryNote} ${hasCurrentEntry ? styles.entryActive : ""}`}
                id="desktop-action-note"
              >
                {actionNote}
              </p>
            </div>
          </div>
        </section>

        <section className={styles.proof} aria-label="Zasady bezpieczeństwa aukcji">
          <div className={styles.proofItem}><strong>Jedna cena</strong><span>Rezerwujemy kwotę widoczną w chwili zwycięskiego kliknięcia.</span></div>
          <div className={styles.proofItem}><strong>Jeden zwycięzca</strong><span>Serwer rozstrzyga kliknięcia, także gdy wpadają niemal równocześnie.</span></div>
          <div className={styles.proofItem}><strong>Bezpieczna płatność</strong><span>Wejście i zakup produktu obsługuje szyfrowany Checkout Stripe.</span></div>
        </section>
      </div>

      <div className={styles.mobileAction}>
        <button
          className={styles.primaryButton}
          type="button"
          disabled={actionDisabled}
          aria-busy={isEntering || isBuying}
          aria-describedby="mobile-action-note"
          onClick={handleAction}
        >
          {actionLabel}
        </button>
        <p
          className={`${styles.entryNote} ${hasCurrentEntry ? styles.entryActive : ""}`}
          id="mobile-action-note"
        >
          {actionNote}
        </p>
      </div>
    </main>
  );
}
