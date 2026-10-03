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

function waitedLongerPercent(liveElapsed: number, liveSeconds: number) {
  const timing = Math.min(1, Math.max(0, liveElapsed / liveSeconds));
  return Math.round(46 - timing * 28);
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
  const timingPercent = waitedLongerPercent(liveElapsed, liveSecondsRef.current);

  const shareResult = async () => {
    const resultText = state === "won"
      ? `Nie wygrywa ten, kto czeka najdłużej. Wylicytowałem ${product.name} za ${price} zł. To nie była tylko cena. To była decyzja. Tak wygląda decyzja na Fiszy. Przywracamy emocje zakupów.`
      : `Nie wygrywa ten, kto czeka najdłużej. Zatrzymałem się przy ${price} zł. Tak wygląda decyzja na Fiszy. Przywracamy emocje zakupów.`;
    const productImage = await new Promise<HTMLImageElement | null>((resolve) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = product.image;
    });
    const card = await new Promise<File | null>((resolve) => {
      const canvas = document.createElement("canvas");
      canvas.width = 1080;
      canvas.height = 1920;
      const context = canvas.getContext("2d");
      if (!context) return resolve(null);

      const background = context.createLinearGradient(0, 0, 1080, 1920);
      background.addColorStop(0, "#060509");
      background.addColorStop(0.52, "#16062f");
      background.addColorStop(1, "#08060d");
      context.fillStyle = background;
      context.fillRect(0, 0, canvas.width, canvas.height);

      const glow = context.createRadialGradient(540, 780, 20, 540, 780, 700);
      glow.addColorStop(0, "rgba(137,71,255,.76)");
      glow.addColorStop(.48, "rgba(99,31,213,.28)");
      glow.addColorStop(1, "rgba(99,31,213,0)");
      context.fillStyle = glow;
      context.fillRect(0, 0, canvas.width, canvas.height);

      context.fillStyle = "#ffffff";
      context.font = "900 102px Arial, sans-serif";
      context.fillText("Fiszy", 82, 142);
      context.fillStyle = "#8f5cff";
      context.fillText(".", 328, 142);

      context.fillStyle = "rgba(255,255,255,.18)";
      context.fillRect(82, 202, 916, 2);

      if (productImage) {
        context.save();
        context.globalAlpha = .98;
        context.drawImage(productImage, 150, 265, 780, 690);
        context.restore();
      }

      context.fillStyle = "rgba(6,5,9,.70)";
      context.fillRect(0, 915, 1080, 1005);
      const lowerGlow = context.createRadialGradient(540, 960, 0, 540, 960, 650);
      lowerGlow.addColorStop(0, "rgba(129,66,255,.40)");
      lowerGlow.addColorStop(1, "rgba(129,66,255,0)");
      context.fillStyle = lowerGlow;
      context.fillRect(0, 820, 1080, 900);

      context.textAlign = "center";
      context.fillStyle = "#c9adff";
      context.font = "800 34px Arial, sans-serif";
      context.fillText(state === "won" ? "WYLICYTOWAŁEM" : "ZATRZYMAŁEM SIĘ PRZY", 540, 1040);

      context.fillStyle = "#ffffff";
      context.font = "900 136px Arial, sans-serif";
      context.fillText(`${price} zł`, 540, 1190);

      context.fillStyle = "#eae4f5";
      context.font = "700 50px Arial, sans-serif";
      context.fillText(product.name, 540, 1285);

      context.fillStyle = "rgba(255,255,255,.18)";
      context.fillRect(182, 1370, 716, 2);

      context.fillStyle = "#ffffff";
      context.font = "800 58px Arial, sans-serif";
      context.fillText("To nie była tylko cena.", 540, 1490);
      context.fillText("To była decyzja.", 540, 1565);

      context.fillStyle = "#c9adff";
      context.font = "700 38px Arial, sans-serif";
      context.fillText("Tak wygląda decyzja na Fiszy.", 540, 1730);
      context.fillStyle = "#ffffff";
      context.font = "800 34px Arial, sans-serif";
      context.fillText("PRZYWRACAMY EMOCJE ZAKUPÓW", 540, 1815);

      canvas.toBlob((blob) => resolve(blob ? new File([blob], "fiszy-moj-timing.png", { type: "image/png" }) : null), "image/png");
    });

    try {
      if (card && navigator.share && (!navigator.canShare || navigator.canShare({ files: [card] }))) {
        await navigator.share({ files: [card], title: "Mój timing w Fiszy", text: resultText });
      } else if (card) {
        const downloadUrl = URL.createObjectURL(card);
        const link = document.createElement("a");
        link.href = downloadUrl;
        link.download = "fiszy-moj-timing.png";
        link.click();
        URL.revokeObjectURL(downloadUrl);
      } else if (navigator.share) {
        await navigator.share({ title: "Mój timing w Fiszy", text: resultText, url: window.location.href });
      } else {
        return;
      }
      track("demo_result_shared", { product: product.id, price, outcome: state, waited_longer_percent: timingPercent });
    } catch {
      // Zamknięcie panelu udostępniania nie jest błędem dla użytkownika.
    }
  };

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
              <div className={styles.timingResult}>
                <span>Twój timing</span>
                <strong>Kliknąłeś przy {price} zł.</strong>
                <p>{timingPercent}% osób czekało dłużej.</p>
                <button type="button" onClick={shareResult}>Udostępnij kartę w Stories</button>
              </div>
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
              <div className={styles.timingResult}>
                <span>Twój timing</span>
                <strong>Dotarłeś do {price} zł.</strong>
                <p>{timingPercent}% osób czekało dłużej.</p>
                <button type="button" onClick={shareResult}>Udostępnij kartę w Stories</button>
              </div>
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
