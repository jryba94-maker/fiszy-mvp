"use client";

import { useEffect, useState } from "react";

type AuctionState = {
  auctionId: string;
  product: string;
  regularPrice: number;
  currentPrice: number;
  entryFee: number;
  status: "live";
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
        // Keep the last known price visible if the demo endpoint is temporarily unavailable.
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

  return (
    <main className="pageShell">
      <header className="brandBar">
        <div className="brand">Fiszy</div>
        <div className="liveBadge">AUKCJA LIVE</div>
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

          <p className="auctionMessage">Cena spada. Kupujesz za cenę, którą widzisz.</p>

          <button className="buyButton" type="button">
            KUP TERAZ — {currentPrice} zł
          </button>

          <div className="entryFee">Wejście do aukcji: <strong>5 zł</strong></div>
        </div>
      </section>
    </main>
  );
}
