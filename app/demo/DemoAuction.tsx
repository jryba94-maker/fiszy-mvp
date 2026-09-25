"use client";

import { track } from "@vercel/analytics";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import styles from "./demo.module.css";

const START_PRICE = 599;
const DROP = 29;
const COUNTDOWN_SECONDS = 5;
const LIVE_SECONDS = 35;

type DemoState = "countdown" | "live" | "won" | "lost";

function formatSeconds(value: number) {
  return `00:${String(Math.max(0, value)).padStart(2, "0")}`;
}

export function DemoAuction() {
  const [state, setState] = useState<DemoState>("countdown");
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(Date.now());
  const reportedStart = useRef(false);

  useEffect(() => {
    track("demo_auction_opened", { product: "airpods", start_price: START_PRICE });
    const interval = window.setInterval(() => {
      const passed = Math.floor((Date.now() - startRef.current) / 1000);
      if (passed < COUNTDOWN_SECONDS) {
        setElapsed(passed);
        return;
      }
      const liveElapsed = passed - COUNTDOWN_SECONDS;
      if (!reportedStart.current) {
        reportedStart.current = true;
        track("demo_auction_started", { product: "airpods" });
      }
      if (liveElapsed >= LIVE_SECONDS) {
        setElapsed(LIVE_SECONDS);
        setState((current) => current === "won" ? current : "lost");
        window.clearInterval(interval);
        return;
      }
      setState("live");
      setElapsed(liveElapsed);
    }, 200);
    return () => window.clearInterval(interval);
  }, []);

  const liveElapsed = state === "countdown" ? 0 : elapsed;
  const price = START_PRICE - Math.floor(liveElapsed / 5) * DROP;
  const remaining = state === "countdown"
    ? COUNTDOWN_SECONDS - elapsed
    : Math.max(0, LIVE_SECONDS - liveElapsed);
  const progress = Math.min(100, (liveElapsed / LIVE_SECONDS) * 100);

  const restart = () => {
    startRef.current = Date.now();
    reportedStart.current = false;
    setElapsed(0);
    setState("countdown");
    track("demo_auction_restarted", { product: "airpods" });
  };

  const buy = () => {
    if (state !== "live") return;
    setState("won");
    track("demo_auction_won", { product: "airpods", price });
  };

  const status = state === "countdown"
    ? "DEMO ZA CHWILĘ"
    : state === "live"
      ? "AUKCJA TRWA"
      : "DEMO ZAKOŃCZONE";
  const message = state === "countdown"
    ? "Za chwilę cena zacznie spadać. Gdy ruszy — decyzja będzie należeć do Ciebie."
    : state === "live"
      ? "Cena właśnie spada. Kliknij, zanim ktoś zrobi to przed Tobą."
      : state === "won"
        ? `Byłeś pierwszy. W tym demo kupiłeś AirPods za ${price} zł.`
        : `Ktoś był szybszy i kupił AirPods za ${price} zł.`;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.logo} href="/" aria-label="Fiszy — strona główna">Fiszy<span>.</span></Link>
        <span className={styles.demoBadge}>Demo aukcji</span>
      </header>

      <section className={styles.shell} aria-labelledby="demo-title">
        <div className={styles.visual} aria-hidden="true">
          <div className={styles.halo} />
          <div className={styles.case}><span /><i /><b /></div>
          <div className={styles.airpodLeft} />
          <div className={styles.airpodRight} />
          <p>AirPods Pro</p>
        </div>

        <div className={styles.panel}>
          <div className={styles.topline}>
            <span className={`${styles.status} ${state === "live" ? styles.statusLive : ""}`}><i /> {status}</span>
            <span className={styles.regularPrice}>cena regularna 599 zł</span>
          </div>
          <p className={styles.eyebrow}>Jedna decyzja. Jedna cena.</p>
          <h1 id="demo-title">AirPods Pro</h1>

          <div className={styles.priceBlock}>
            <span>Aktualna cena</span>
            <strong aria-live="polite">{price} zł</strong>
            <div className={styles.progress} aria-hidden="true"><i style={{ width: `${progress}%` }} /></div>
          </div>

          {state !== "live" ? (
            <div className={styles.clockBox}>
              <div>
                <span>{state === "countdown" ? "Start aukcji za" : "Czas aukcji"}</span>
                <strong>{formatSeconds(state === "countdown" ? remaining : 0)}</strong>
              </div>
              <p>{state === "countdown" ? "Przygotuj się." : "Tak działa presja momentu."}</p>
            </div>
          ) : null}

          <p className={styles.message} aria-live="polite">{message}</p>

          {state === "won" ? (
            <section className={styles.winnerCard} aria-live="assertive" aria-label={`Wygrałeś AirPods za ${price} zł`}>
              <span className={styles.winnerSpark} aria-hidden="true">✦</span>
              <p>Twoja decyzja przyszła pierwsza.</p>
              <h2>Wygrałeś.</h2>
              <strong>AirPods za {price} zł</strong>
              <Link className={styles.winnerCta} href="/#zapis" onClick={() => track("demo_auction_waitlist_click", { outcome: "won" })}>
                CHCĘ SPRÓBOWAĆ NAPRAWDĘ
              </Link>
            </section>
          ) : state === "live" ? (
            <button className={styles.buyButton} type="button" onClick={buy}>KUP TERAZ — {price} ZŁ</button>
          ) : state === "countdown" ? (
            <button className={styles.buyButton} type="button" disabled>ZA CHWILĘ START</button>
          ) : (
            <div className={styles.endActions}>
              <Link className={styles.joinButton} href="/#zapis" onClick={() => track("demo_auction_waitlist_click", { outcome: state })}>CHCĘ BYĆ NA PIERWSZEJ AUKCJI</Link>
              <button className={styles.restartButton} type="button" onClick={restart}>Zagraj jeszcze raz</button>
            </div>
          )}
          <p className={styles.note}>To symulacja. Niczego tutaj nie kupujesz ani nie płacisz.</p>
        </div>
      </section>
    </main>
  );
}
