"use client";

import { useEffect, useState } from "react";

const START_PRICE = 749;
const FLOOR_PRICE = 699;
const DROP_INTERVAL_MS = 2000;

export default function Home() {
  const [currentPrice, setCurrentPrice] = useState(START_PRICE);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setCurrentPrice((price) => Math.max(FLOOR_PRICE, price - 1));
    }, DROP_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, []);

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
