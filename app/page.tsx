"use client";

import { useEffect, useState } from "react";

type AuctionStatus = "waiting" | "live" | "ended" | "sold";
type PurchaseResult = "won" | "lost" | "error" | null;

type AuctionState = {
  auctionId: string;
  product: string;
  regularPrice: number;
  startPrice: number;
  floorPrice: number;
  currentPrice: number;
  entryFee: number;
  status: AuctionStatus;
  startsAt: string;
  endsAt: string;
  soldAt: string | null;
  storageReady: boolean;
  serverTime: string;
};

type BuyResponse = {
  outcome: "won" | "lost" | "not_live" | "storage_error" | "invalid_request";
  price?: number;
  winnerPrice?: number | null;
};

const FALLBACK_PRICE = 749;
const BIDDER_STORAGE_KEY = "fiszy-demo-bidder-id";

function getBidderId() {
  const existing = window.localStorage.getItem(BIDDER_STORAGE_KEY);
  if (existing) return existing;

  const created = window.crypto.randomUUID();
  window.localStorage.setItem(BIDDER_STORAGE_KEY, created);
  return created;
}

export default function Home() {
  const [auction, setAuction] = useState<AuctionState | null>(null);
  const [isBuying, setIsBuying] = useState(false);
  const [purchaseResult, setPurchaseResult] = useState<PurchaseResult>(null);

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

  const currentPrice = auction?.currentPrice ?? FALLBACK_PRICE;
  const status = auction?.status ?? "waiting";
  const isLive = status === "live";
  const isEnded = status === "ended";
  const isSold = status === "sold";
  const storageReady = auction?.storageReady ?? false;

  const handleBuy = async () => {
    if (!isLive || isBuying || !storageReady) return;

    setIsBuying(true);
    setPurchaseResult(null);

    try {
      const response = await fetch("/api/auction/buy", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ bidderId: getBidderId() }),
      });

      const data = (await response.json()) as BuyResponse;

      if (data.outcome === "won") {
        setPurchaseResult("won");
        setAuction((current) =>
          current
            ? {
                ...current,
                status: "sold",
                currentPrice: data.price ?? current.currentPrice,
              }
            : current,
        );
        return;
      }

      if (data.outcome === "lost") {
        setPurchaseResult("lost");
        setAuction((current) =>
          current
            ? {
                ...current,
                status: "sold",
                currentPrice: data.winnerPrice ?? current.currentPrice,
              }
            : current,
        );
        return;
      }

      setPurchaseResult("error");
    } catch {
      setPurchaseResult("error");
    } finally {
      setIsBuying(false);
    }
  };

  const statusLabel = purchaseResult === "won"
    ? "WYGRYWASZ"
    : status === "live"
      ? "AUKCJA LIVE"
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

  if (purchaseResult === "won") {
    auctionMessage = `Twój klik był pierwszy. Kupujesz AirPods Pro za ${currentPrice} zł.`;
  } else if (purchaseResult === "lost") {
    auctionMessage = "Ktoś kliknął wcześniej. Aukcja została już zamknięta.";
  } else if (!storageReady && auction) {
    auctionMessage = "Mechanizm zakupu jest chwilowo niedostępny.";
  } else if (isSold) {
    auctionMessage = `Produkt został kupiony za ${currentPrice} zł.`;
  } else if (isLive) {
    auctionMessage = "Cena spada. Kupujesz za cenę, którą widzisz.";
  } else if (isEnded) {
    auctionMessage = "Aukcja zakończona. Cena nie uruchomi się ponownie.";
  } else {
    auctionMessage = `Start aukcji: ${startTime}. Cena zacznie spadać automatycznie.`;
  }

  const buttonLabel = purchaseResult === "won"
    ? `WYGRYWASZ — ${currentPrice} zł`
    : isSold
      ? "SPRZEDANE"
      : isEnded
        ? "AUKCJA ZAKOŃCZONA"
        : isLive
          ? isBuying
            ? "SPRAWDZAM..."
            : `KUP TERAZ — ${currentPrice} zł`
          : "OCZEKIWANIE NA START";

  return (
    <main className="pageShell">
      <header className="brandBar">
        <div className="brand">Fiszy</div>
        <div className="liveBadge">{statusLabel}</div>
      </header>

      <section className="auctionCard" aria-labelledby="auction-title">
        <div className="productVisual" role="img" aria-label="Miejsce na zdjęcie AirPods Pro">
          <span>AirPods Pro</span>
        </div>

        <div className="auctionContent">
          <p className="eyebrow">Pierwsza aukcja testowa</p>
          <h1 id="auction-title">AirPods Pro</h1>

          <div className="priceBlock">
            <div className="regularPrice">
              Cena regularna <span>999 zł</span>
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

          <button
            className="buyButton"
            type="button"
            onClick={handleBuy}
            disabled={!isLive || isBuying || !storageReady}
          >
            {buttonLabel}
          </button>

          <div className="entryFee">
            Wejście do aukcji: <strong>{auction?.entryFee ?? 5} zł</strong>
          </div>
        </div>
      </section>
    </main>
  );
}
