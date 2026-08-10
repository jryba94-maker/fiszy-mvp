export default function Home() {
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
            <div className="currentPrice" aria-label="Aktualna cena 749 zł">
              749 zł
            </div>
          </div>

          <p className="auctionMessage">Cena spada. Kupujesz za cenę, którą widzisz.</p>

          <button className="buyButton" type="button">
            KUP TERAZ — 749 zł
          </button>

          <div className="entryFee">Wejście do aukcji: <strong>5 zł</strong></div>
        </div>
      </section>
    </main>
  );
}
