"use client";

import { useEffect, useState } from "react";

type AuctionStatus = "waiting" | "live" | "ended";

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
  serverTime: string;
};

const FALLBACK_PRICE = 749;

export default function Home() {
  const [auction, setAuction] = useState<AuctionState | null>(null);

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

  const statusLabel =
    status === "live" ? "AUKCJA LIVE" : status === "ended" ? "AUKCJA ZAKOŃCZONA" : "AUKCJA OCZEKUJE";

  const startTime = auction?.startsAt
    ? new Date(auction.startsAt).toLocaleTimeString("pl-PL", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "--:--";

  const auctionMessage = isLive
    ? "Cena spada. Kupujesz za cenę, którą widzisz."
    : isEnded
      ? "Aukcja zakończona. Cena nie uruchomi się ponownie."
      : `Start aukcji: ${startTime}. Cena zacznie spadać automatycznie.`;

  const buttonLabel = isEnded ? "AUKCJA ZAKOŃCZONA" : isLive ? `KUP TERAZ — ${currentPrice} zł` : "OCZEKIWANIE NA START";

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

          <p className="auctionMessage">{auctionMessage}</p>

          <button className="buyButton" type="button" disabled={!isLive}>
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
