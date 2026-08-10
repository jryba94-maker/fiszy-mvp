"use client";

import Image, { type ImageLoaderProps } from "next/image";
import { useEffect, useState } from "react";

type AuctionStatus = "waiting" | "live" | "ended" | "payment_pending" | "sold";
type PurchaseResult = "lost" | "error" | null;

type AuctionState = {
  auctionId: string;
  runId: string;
  product: string;
  productImageUrl: string | null;
  regularPrice: number;
  startPrice: number;
  floorPrice: number;
  durationMinutes: number;
  currentPrice: number;
  entryFee: number;
  status: AuctionStatus;
  startsAt: string;
  endsAt: string;
  soldAt: string | null;
  paymentExpiresAt?: string | null;
  storageReady: boolean;
  serverTime: string;
};

type BuyResponse = {
  outcome:
    | "checkout"
    | "lost"
    | "not_live"
    | "entry_required"
    | "stripe_not_configured"
    | "payment_error"
    | "storage_error"
    | "invalid_request";
  price?: number;
  winnerPrice?: number | null;
  checkoutUrl?: string | null;
};

type EntryResponse = {
  outcome:
    | "ok"
    | "checkout"
    | "already_granted"
    | "auction_unavailable"
    | "stripe_not_configured"
    | "payment_error"
    | "storage_error"
    | "invalid_request";
  runId?: string;
  hasEntry?: boolean;
  entryFee?: number;
  checkoutUrl?: string | null;
};

type CancelPurchaseResponse = {
  outcome:
    | "cancelled"
    | "nothing_to_cancel"
    | "already_paid"
    | "cannot_cancel"
    | "stripe_not_configured"
    | "storage_error"
    | "invalid_request";
};

const FALLBACK_PRICE = 749;
const BIDDER_STORAGE_KEY = "fiszy-demo-bidder-id";

function productImageLoader({ src }: ImageLoaderProps) {
  return src;
}

function getBidderId() {
  const existing = window.localStorage.getItem(BIDDER_STORAGE_KEY);
  if (existing) return existing;

  const created = window.crypto.randomUUID();
  window.localStorage.setItem(BIDDER_STORAGE_KEY, created);
  return created;
}

function clearQueryParam(name: string) {
  const url = new URL(window.location.href);
  url.searchParams.delete(name);
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

export default function Home() {
  const [auction, setAuction] = useState<AuctionState | null>(null);
  const [isBuying, setIsBuying] = useState(false);
  const [purchaseResult, setPurchaseResult] = useState<PurchaseResult>(null);
  const [purchaseMessage, setPurchaseMessage] = useState("");
  const [hasEntry, setHasEntry] = useState(false);
  const [entryRunId, setEntryRunId] = useState<string | null>(null);
  const [isEntering, setIsEntering] = useState(false);
  const [entryMessage, setEntryMessage] = useState("");
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    let active = true;

    const loadAuction = async () => {
      try {
        const response = await fetch("/api/auction", { cache: "no-store" });
        if (!response.ok) return;

        const data = (await response.json()) as AuctionState;
        if (active) setAuction(data);
      } catch {
        // Keep the last known auction state visible if the endpoint is temporarily unavailable.
      }
    };

    void loadAuction();
    const timer = window.setInterval(() => void loadAuction(), 1000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    setImageFailed(false);
  }, [auction?.productImageUrl]);

  useEffect(() => {
    if (!auction?.runId) return;

    let active = true;
    let retryTimer: number | undefined;
    let attempts = 0;
    const runId = auction.runId;
    const paymentState = new URLSearchParams(window.location.search).get("payment");

    setPurchaseResult(null);
    setHasEntry(false);
    setEntryRunId(runId);

    if (paymentState === "success") {
      setEntryMessage("Płatność zakończona. Czekam na potwierdzenie Stripe...");
    } else if (paymentState === "cancelled") {
      setEntryMessage("Płatność została anulowana. Wejście nie zostało aktywowane.");
      clearQueryParam("payment");
    } else {
      setEntryMessage("");
    }

    const loadEntry = async (): Promise<boolean> => {
      try {
        const bidderId = getBidderId();
        const response = await fetch(
          `/api/auction/entry?bidderId=${encodeURIComponent(bidderId)}`,
          { cache: "no-store" },
        );

        if (!response.ok) return false;
        const data = (await response.json()) as EntryResponse;
        if (!active) return false;

        const granted = Boolean(data.hasEntry && data.runId === runId);
        setHasEntry(granted);
        setEntryRunId(data.runId ?? runId);

        if (granted && paymentState === "success") {
          setEntryMessage("Płatność potwierdzona. Masz dostęp do tej aukcji.");
          clearQueryParam("payment");
        }

        return granted;
      } catch {
        return false;
      }
    };

    const checkEntry = async () => {
      const granted = await loadEntry();
      if (!active || granted || paymentState !== "success") return;

      attempts += 1;
      if (attempts >= 15) {
        setEntryMessage(
          "Wejście nie zostało przyznane. Jeśli aukcja zakończyła się podczas płatności, 5 zł zostanie automatycznie zwrócone.",
        );
        clearQueryParam("payment");
        return;
      }

      retryTimer = window.setTimeout(() => void checkEntry(), 800);
    };

    void checkEntry();

    return () => {
      active = false;
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [auction?.runId]);

  useEffect(() => {
    if (!auction?.runId) return;

    const purchaseState = new URLSearchParams(window.location.search).get("purchase");
    if (!purchaseState) return;

    if (purchaseState === "success") {
      if (auction.status === "sold") {
        setPurchaseMessage("Płatność potwierdzona. Produkt jest Twój.");
        clearQueryParam("purchase");
      } else {
        setPurchaseMessage("Płatność zakończona. Czekam na potwierdzenie Stripe...");
      }
      return;
    }

    if (purchaseState !== "cancelled") return;

    let active = true;
    setPurchaseMessage("Anuluję rezerwację płatności...");

    const cancelPurchase = async () => {
      try {
        const response = await fetch("/api/auction/purchase/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bidderId: getBidderId() }),
        });
        const data = (await response.json()) as CancelPurchaseResponse;
        if (!active) return;

        if (data.outcome === "cancelled" || data.outcome === "nothing_to_cancel") {
          setPurchaseMessage("Płatność została anulowana. Zakup nie został opłacony.");
          clearQueryParam("purchase");
        } else if (data.outcome === "already_paid") {
          setPurchaseMessage("Płatność została już potwierdzona.");
          clearQueryParam("purchase");
        } else {
          setPurchaseMessage(
            "Nie udało się bezpiecznie anulować płatności. Rezerwacja pozostaje zablokowana.",
          );
        }
      } catch {
        if (active) {
          setPurchaseMessage(
            "Nie udało się bezpiecznie anulować płatności. Rezerwacja pozostaje zablokowana.",
          );
        }
      }
    };

    void cancelPurchase();

    return () => {
      active = false;
    };
  }, [auction?.runId, auction?.status]);

  const currentPrice = auction?.currentPrice ?? FALLBACK_PRICE;
  const productName = auction?.product ?? "AirPods Pro";
  const productImageUrl = auction?.productImageUrl ?? null;
  const status = auction?.status ?? "waiting";
  const isLive = status === "live";
  const isEnded = status === "ended";
  const isPaymentPending = status === "payment_pending";
  const isSold = status === "sold";
  const storageReady = auction?.storageReady ?? false;
  const hasCurrentEntry = Boolean(
    auction?.runId && hasEntry && entryRunId === auction.runId,
  );

  const handleEntry = async () => {
    if (!auction || hasCurrentEntry || isEntering || !storageReady) return;

    setIsEntering(true);
    setEntryMessage("");

    try {
      const response = await fetch("/api/auction/entry", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ bidderId: getBidderId() }),
      });

      const data = (await response.json()) as EntryResponse;

      if (data.outcome === "checkout" && data.checkoutUrl) {
        window.location.assign(data.checkoutUrl);
        return;
      }

      if (data.outcome === "already_granted" && data.runId) {
        setHasEntry(true);
        setEntryRunId(data.runId);
        setEntryMessage("Masz już opłacone wejście do tej aukcji.");
        return;
      }

      if (data.outcome === "auction_unavailable") {
        setEntryMessage("Do tej aukcji nie można już wykupić wejścia.");
      } else if (data.outcome === "stripe_not_configured") {
        setEntryMessage("Stripe nie jest jeszcze skonfigurowany po stronie serwera.");
      } else {
        setEntryMessage("Nie udało się rozpocząć płatności. Spróbuj ponownie.");
      }
    } catch {
      setEntryMessage("Nie udało się rozpocząć płatności. Spróbuj ponownie.");
    } finally {
      setIsEntering(false);
    }
  };

  const handleBuy = async () => {
    if (!isLive || isBuying || !storageReady || !hasCurrentEntry) return;

    setIsBuying(true);
    setPurchaseResult(null);
    setPurchaseMessage("");

    try {
      const response = await fetch("/api/auction/buy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ bidderId: getBidderId() }),
      });

      const data = (await response.json()) as BuyResponse;

      if (data.outcome === "checkout" && data.checkoutUrl) {
        window.location.assign(data.checkoutUrl);
        return;
      }

      if (data.outcome === "lost") {
        setPurchaseResult("lost");
        setAuction((current) =>
          current
            ? {
                ...current,
                status: "payment_pending",
                currentPrice: data.winnerPrice ?? current.currentPrice,
              }
            : current,
        );
        return;
      }

      if (data.outcome === "entry_required") {
        setHasEntry(false);
        setEntryRunId(auction?.runId ?? null);
        setEntryMessage("Najpierw opłać wejście do tej aukcji.");
        return;
      }

      setPurchaseResult("error");
      setPurchaseMessage("Nie udało się rozpocząć płatności za wygrany produkt.");
    } catch {
      setPurchaseResult("error");
      setPurchaseMessage("Nie udało się rozpocząć płatności za wygrany produkt.");
    } finally {
      setIsBuying(false);
    }
  };

  const statusLabel = status === "live"
    ? "AUKCJA LIVE"
    : status === "payment_pending"
      ? "OCZEKUJE NA PŁATNOŚĆ"
      : status === "sold"
        ? "SPRZEDANE"
        : status === "ended"
          ? "AUKCJA ZAKOŃCZONA"
          : "AUKCJA OCZEKUJE";

  const startTime = auction?.startsAt
    ? new Date(auction.startsAt).toLocaleTimeString("pl-PL", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "--:--";

  let auctionMessage: string;

  if (purchaseResult === "lost") {
    auctionMessage = "Ktoś kliknął wcześniej. Produkt został zarezerwowany dla zwycięzcy.";
  } else if (!storageReady && auction) {
    auctionMessage = "Mechanizm zakupu jest chwilowo niedostępny.";
  } else if (isPaymentPending) {
    auctionMessage = `Pierwszy klik został zarezerwowany przy cenie ${currentPrice} zł. Czekamy na płatność zwycięzcy.`;
  } else if (isSold) {
    auctionMessage = `Produkt został opłacony za ${currentPrice} zł.`;
  } else if (isLive && !hasCurrentEntry) {
    auctionMessage = "Aby kupić w tej aukcji, najpierw opłać wejście 5 zł.";
  } else if (isLive) {
    auctionMessage = "Cena spada. Kupujesz za cenę, którą widzisz.";
  } else if (isEnded) {
    auctionMessage = "Aukcja zakończona. Cena nie uruchomi się ponownie.";
  } else {
    auctionMessage = `Start aukcji: ${startTime}. Cena zacznie spadać automatycznie.`;
  }

  const buttonLabel = isSold
    ? "SPRZEDANE"
    : isPaymentPending
      ? "ZAREZERWOWANE — PŁATNOŚĆ"
      : isEnded
        ? "AUKCJA ZAKOŃCZONA"
        : isLive
          ? !hasCurrentEntry
            ? "WEJŚCIE WYMAGANE"
            : isBuying
              ? "REZERWUJĘ..."
              : `KUP TERAZ — ${currentPrice} zł`
          : "OCZEKIWANIE NA START";

  const canEnter =
    !isSold && !isPaymentPending && !isEnded && storageReady && !hasCurrentEntry;

  return (
    <main className="pageShell">
      <header className="brandBar">
        <div className="brand">Fiszy</div>
        <div className="liveBadge">{statusLabel}</div>
      </header>

      <section className="auctionCard" aria-labelledby="auction-title">
        <div className="productVisual">
          {productImageUrl && !imageFailed ? (
            <Image
              className="productImage"
              loader={productImageLoader}
              src={productImageUrl}
              alt={productName}
              fill
              sizes="(max-width: 820px) 100vw, 55vw"
              unoptimized
              priority
              onError={() => setImageFailed(true)}
            />
          ) : (
            <span role="img" aria-label={`Brak zdjęcia produktu ${productName}`}>
              {productName}
            </span>
          )}
        </div>

        <div className="auctionContent">
          <p className="eyebrow">
            Aukcja • {auction?.durationMinutes ?? 10} min
          </p>
          <h1 id="auction-title">{productName}</h1>

          <div className="priceBlock">
            <div className="regularPrice">
              Cena regularna <span>{auction?.regularPrice ?? 999} zł</span>
            </div>
            <div className="currentPriceLabel">Aktualna cena</div>
            <div
              className="currentPrice"
              aria-live="polite"
              aria-label={`Aktualna cena ${currentPrice} zł`}
            >
              {currentPrice} zł
            </div>
          </div>

          <p className="auctionMessage" aria-live="polite">{auctionMessage}</p>

          {canEnter ? (
            <button
              className="buyButton"
              type="button"
              onClick={handleEntry}
              disabled={isEntering}
            >
              {isEntering
                ? "PRZECHODZĘ DO PŁATNOŚCI..."
                : `OPŁAĆ WEJŚCIE — ${auction?.entryFee ?? 5} ZŁ`}
            </button>
          ) : null}

          {entryMessage ? <p className="auctionMessage" aria-live="polite">{entryMessage}</p> : null}
          {purchaseMessage ? <p className="auctionMessage" aria-live="polite">{purchaseMessage}</p> : null}

          <button
            className="buyButton"
            type="button"
            onClick={handleBuy}
            disabled={!isLive || isBuying || !storageReady || !hasCurrentEntry}
          >
            {buttonLabel}
          </button>

          <div className="entryFee">
            {hasCurrentEntry ? "Wejście opłacone: " : "Wejście do aukcji: "}
            <strong>{auction?.entryFee ?? 5} zł</strong>
          </div>
        </div>
      </section>
    </main>
  );
}
