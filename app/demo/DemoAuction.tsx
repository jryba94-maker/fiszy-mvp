"use client";

import { track } from "@vercel/analytics";
import Link from "next/link";
import { landingAttribution, landingSourceLabel } from "../../lib/landing-attribution";
import { type FormEvent, useEffect, useRef, useState } from "react";
import styles from "./demo.module.css";

const COUNTDOWN_SECONDS = 5;
const MIN_LIVE_SECONDS = 15;
const MAX_LIVE_SECONDS = 35;

type DemoState = "countdown" | "live" | "won" | "lost";

type DemoProduct = {
  id: string;
  name: string;
  price: number;
  image: string;
};

const DEMO_PRODUCTS: DemoProduct[] = [
  {
    id: "airpods-pro-3",
    name: "AirPods Pro 3",
    price: 1099,
    image: "/demo/packshots/airpods.webp",
  },
  {
    id: "apple-watch-se-3",
    name: "Apple Watch SE 3",
    price: 1099,
    image: "/demo/packshots/watch.webp",
  },
  {
    id: "nintendo-switch-2",
    name: "Nintendo Switch 2",
    price: 2199,
    image: "/demo/packshots/switch.webp",
  },
  {
    id: "dyson-airwrap-id",
    name: "Dyson Airwrap i.d.",
    price: 1999,
    image: "/demo/packshots/dyson.webp",
  },
];

function randomLiveSeconds() {
  return Math.floor(Math.random() * (MAX_LIVE_SECONDS - MIN_LIVE_SECONDS + 1)) + MIN_LIVE_SECONDS;
}

function randomProduct(exceptId?: string) {
  const options = exceptId
    ? DEMO_PRODUCTS.filter((product) => product.id !== exceptId)
    : DEMO_PRODUCTS;
  return options[Math.floor(Math.random() * options.length)];
}

function formatSeconds(value: number) {
  return `00:${String(Math.max(0, value)).padStart(2, "0")}`;
}

function demoVisitorId() {
  try {
    const key = "fiszy_landing_visitor_id";
    const saved = localStorage.getItem(key);
    if (saved && /^[a-f0-9-]{36}$/i.test(saved)) return saved;
    const id = crypto.randomUUID();
    localStorage.setItem(key, id);
    return id;
  } catch { return crypto.randomUUID(); }
}

function demoSessionId() {
  try {
    const key = "fiszy_landing_session";
    const now = Date.now();
    const saved = JSON.parse(localStorage.getItem(key) || "null") as { id?: unknown; lastSeen?: unknown } | null;
    const id = saved && typeof saved.lastSeen === "number" && now - saved.lastSeen >= 0 && now - saved.lastSeen < 30 * 60_000 && typeof saved.id === "string" && /^[a-f0-9-]{36}$/i.test(saved.id)
      ? saved.id : crypto.randomUUID();
    localStorage.setItem(key, JSON.stringify({ id, lastSeen: now }));
    return id;
  } catch { return crypto.randomUUID(); }
}

export function DemoAuction() {
  const [state, setState] = useState<DemoState>("countdown");
  const [elapsed, setElapsed] = useState(0);
  const [runId, setRunId] = useState(0);
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [signupState, setSignupState] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [signupMessage, setSignupMessage] = useState("");
  const productRef = useRef<DemoProduct>(randomProduct());
  const liveSecondsRef = useRef(randomLiveSeconds());
  const startRef = useRef(Date.now());
  const reportedStart = useRef(false);
  const finishedRef = useRef(false);
  const trafficSessionRef = useRef("");
  const trafficSourceRef = useRef("direct");
  const trafficAttributionRef = useRef<ReturnType<typeof landingAttribution> | null>(null);
  const signupStartedRef = useRef(false);

  useEffect(() => {
    const product = productRef.current;
    track("demo_auction_opened", { product: product.id, start_price: product.price });
    const sessionId = demoSessionId();
    const visitorId = demoVisitorId();
    const attribution = landingAttribution();
    const source = landingSourceLabel(attribution);
    const durationId = crypto.randomUUID();
    trafficSessionRef.current = sessionId;
    trafficSourceRef.current = source;
    trafficAttributionRef.current = attribution;
    void fetch("/api/analytics/landing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "view", page: "demo", sessionId, viewId: crypto.randomUUID(), visitorId, source }),
      keepalive: true,
    }).catch(() => undefined);
    void fetch("/api/analytics/landing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "event", event: "demo_opened", sessionId, source }),
      keepalive: true,
    }).catch(() => undefined);

    let visibleStartedAt = performance.now();
    let activeMs = 0;
    const closeVisibleWindow = () => {
      if (visibleStartedAt) { activeMs += performance.now() - visibleStartedAt; visibleStartedAt = 0; }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") closeVisibleWindow();
      else if (!visibleStartedAt) visibleStartedAt = performance.now();
    };
    const reportDuration = () => {
      closeVisibleWindow();
      void fetch("/api/analytics/landing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "duration", sessionId, durationId, source, seconds: Math.round(activeMs / 1000) }),
        keepalive: true,
      }).catch(() => undefined);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", reportDuration);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", reportDuration);
      reportDuration();
    };
  }, []);

  useEffect(() => {
    let frame = 0;
    const tick = () => {
      if (finishedRef.current) return;
      const passed = (Date.now() - startRef.current) / 1000;
      if (passed < COUNTDOWN_SECONDS) {
        setElapsed(passed);
        frame = window.requestAnimationFrame(tick);
        return;
      }

      const liveElapsed = passed - COUNTDOWN_SECONDS;
      if (!reportedStart.current) {
        reportedStart.current = true;
        track("demo_auction_started", { product: productRef.current.id });
      }
      if (liveElapsed >= liveSecondsRef.current) {
        setElapsed(liveSecondsRef.current);
        finishedRef.current = true;
        if (trafficSessionRef.current) void fetch("/api/analytics/landing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "event", event: "demo_finished", sessionId: trafficSessionRef.current, source: trafficSourceRef.current }), keepalive: true }).catch(() => undefined);
        if (trafficSessionRef.current) void fetch("/api/analytics/landing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "event", event: "first_auction_cta", sessionId: trafficSessionRef.current, source: trafficSourceRef.current }), keepalive: true }).catch(() => undefined);
        setState((current) => current === "won" ? current : "lost");
        return;
      }

      setState("live");
      setElapsed(liveElapsed);
      frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [runId]);

  const product = productRef.current;
  const drop = Math.round(product.price * 0.08);
  const liveElapsed = state === "countdown" ? 0 : elapsed;
  const price = product.price - Math.floor(liveElapsed / 5) * drop;
  const remaining = state === "countdown"
    ? COUNTDOWN_SECONDS - elapsed
    : Math.max(0, liveSecondsRef.current - liveElapsed);
  const progress = Math.min(100, (liveElapsed / MAX_LIVE_SECONDS) * 100);

  const restart = () => {
    productRef.current = randomProduct(productRef.current.id);
    liveSecondsRef.current = randomLiveSeconds();
    startRef.current = Date.now();
    reportedStart.current = false;
    finishedRef.current = false;
    setElapsed(0);
    setState("countdown");
    setRunId((current) => current + 1);
    track("demo_auction_restarted", { product: productRef.current.id });
  };

  const buy = () => {
    if (state !== "live") return;
    finishedRef.current = true;
    if (trafficSessionRef.current) void fetch("/api/analytics/landing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "event", event: "demo_finished", sessionId: trafficSessionRef.current, source: trafficSourceRef.current }), keepalive: true }).catch(() => undefined);
        if (trafficSessionRef.current) void fetch("/api/analytics/landing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "event", event: "first_auction_cta", sessionId: trafficSessionRef.current, source: trafficSourceRef.current }), keepalive: true }).catch(() => undefined);
    setState("won");
    track("demo_auction_won", { product: product.id, price });
  };

  const submitSignup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedEmail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || !consent) {
      setSignupState("error");
      setSignupMessage(!consent ? "Potwierdź zgodę, aby dołączyć do pierwszej aukcji." : "Wpisz poprawny adres e-mail.");
      return;
    }
    setSignupState("submitting");
    setSignupMessage("");
    const source = trafficAttributionRef.current ?? landingAttribution();
    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail, consent: true, source, traffic: { sessionId: trafficSessionRef.current, source: trafficSourceRef.current } }),
      });
      if (!response.ok) throw new Error("signup_failed");
      const result = await response.json().catch(() => null) as { created?: boolean } | null;
      setSignupState("success");
      setSignupMessage(result?.created === false ? "Ten adres jest już na liście pierwszej aukcji." : "Jesteś na liście. Damy Ci znać przed startem.");
      track("demo_auction_waitlist_signup", { product: product.id, outcome: state });
    } catch {
      setSignupState("error");
      setSignupMessage("Nie udało się zapisać. Spróbuj ponownie za chwilę.");
    }
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
        ? `Byłeś pierwszy. W tym demo kupiłeś ${product.name} za ${price} zł.`
        : `Ktoś był szybszy i kupił ${product.name} za ${price} zł.`;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.logo} href="/" aria-label="Fiszy — strona główna">Fiszy<span>.</span></Link>
        <span className={styles.demoBadge}>Demo aukcji</span>
      </header>

      <section className={styles.shell} aria-labelledby="demo-title">
        <div className={styles.visual} aria-hidden="true">
          <div className={styles.halo} />
          <img className={styles.productImage} src={product.image} alt="" />
          <p>{product.name}</p>
        </div>

        <div className={styles.panel}>
          <div className={styles.topline}>
            <span className={`${styles.status} ${state === "live" ? styles.statusLive : ""}`}><i /> {status}</span>
            <span className={styles.regularPrice}>cena regularna {product.price} zł</span>
          </div>
          <p className={styles.eyebrow}>Jedna decyzja. Jedna cena.</p>
          <h1 id="demo-title">{product.name}</h1>

          <div className={styles.priceBlock}>
            <span>Aktualna cena</span>
            <strong aria-live="polite">{price} zł</strong>
            <div className={styles.progress} aria-hidden="true"><i style={{ width: `${progress}%` }} /></div>
          </div>

          {state !== "live" ? (
            <div className={styles.clockBox}>
              <div>
                <span>{state === "countdown" ? "Start aukcji za" : "Czas aukcji"}</span>
                <strong>{formatSeconds(state === "countdown" ? Math.ceil(remaining) : 0)}</strong>
              </div>
              <p>{state === "countdown" ? "Przygotuj się." : "Tak działa presja momentu."}</p>
            </div>
          ) : null}

          {state === "countdown" || state === "live" ? <p className={styles.message} aria-live="polite">{message}</p> : null}

          {state === "won" ? (
            <section className={styles.winnerCard} aria-live="assertive" aria-label={`Wygrałeś ${product.name} za ${price} zł`}>
              <span className={`${styles.confetti} ${styles.confettiOne}`} aria-hidden="true">✦</span>
              <span className={`${styles.confetti} ${styles.confettiTwo}`} aria-hidden="true">✦</span>
              <span className={`${styles.confetti} ${styles.confettiThree}`} aria-hidden="true">●</span>
              <span className={styles.winnerSpark} aria-hidden="true">✦</span>
              <p>Twoja decyzja przyszła pierwsza</p>
              <h2>Wygrałeś.</h2>
              <strong>{product.name} za {price} zł</strong>
              <span className={styles.winnerNote}>W tej symulacji byłeś szybszy od pozostałych.</span>
                          </section>
          ) : state === "live" ? (
            <button className={styles.buyButton} type="button" onClick={buy}>LICYTUJ! — {price} ZŁ</button>
          ) : state === "countdown" ? (
            <button className={styles.buyButton} type="button" disabled>ZA CHWILĘ START</button>
          ) : (
            <section className={`${styles.winnerCard} ${styles.lostCard}`} aria-live="assertive" aria-label={`Ktoś był przed Tobą i kupił ${product.name} za ${price} zł`}>
              <span className={`${styles.confetti} ${styles.confettiOne}`} aria-hidden="true">✕</span>
              <span className={`${styles.confetti} ${styles.confettiTwo}`} aria-hidden="true">✕</span>
              <span className={styles.winnerSpark} aria-hidden="true">!</span>
              <p>Ktoś podjął decyzję wcześniej</p>
              <h2>Ktoś był przed Tobą.</h2>
              <strong>{product.name} za {price} zł</strong>
              <span className={styles.winnerNote}>W tej symulacji ktoś kliknął szybciej.</span>
                            <button className={styles.restartButton} type="button" onClick={restart}>Zagraj jeszcze raz</button>
            </section>
          )}
          {(state === "won" || state === "lost") ? (
            <section className={`${styles.resultSignup} ${state === "lost" ? styles.resultSignupLost : ""}`} aria-label="Zapis na pierwszą aukcję">
              <p>{state === "won" ? "Chcesz sprawdzić to naprawdę?" : "Następnym razem decyzja będzie należeć do Ciebie."}</p>
              <form className={styles.resultSignupForm} onSubmit={submitSignup}>
                <input id="demo-email" type="email" inputMode="email" autoComplete="email" placeholder="Twój e-mail" value={email} onFocus={() => { if (!signupStartedRef.current && trafficSessionRef.current) { signupStartedRef.current = true; void fetch("/api/analytics/landing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "event", event: "signup_started", sessionId: trafficSessionRef.current, source: trafficSourceRef.current }), keepalive: true }).catch(() => undefined); } }} onChange={(event) => setEmail(event.target.value)} required maxLength={254} disabled={signupState === "submitting" || signupState === "success"} />
                <button type="submit" disabled={signupState === "submitting" || signupState === "success"}>{signupState === "submitting" ? "ZAPISUJĘ…" : signupState === "success" ? "JESTEŚ NA LIŚCIE" : "ZAPISZ MNIE NA PIERWSZĄ AUKCJĘ"}</button>
                <label><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} disabled={signupState === "submitting" || signupState === "success"} /> <span>Tylko informacje o pierwszej aukcji. Bez codziennych maili.</span></label>
                {signupMessage ? <small className={signupState === "success" ? styles.signupSuccess : styles.signupError} aria-live="polite">{signupMessage}</small> : null}
              </form>
            </section>
          ) : null}
          <p className={styles.note}>To symulacja. Niczego tutaj nie kupujesz ani nie płacisz.</p>
        </div>
      </section>
    </main>
  );
}
