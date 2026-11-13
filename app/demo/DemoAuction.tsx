"use client";

import { track } from "@vercel/analytics";
import Link from "next/link";
import { landingAttribution, landingSourceLabel } from "../../lib/landing-attribution";
import { type FormEvent, useEffect, useRef, useState } from "react";
import styles from "./demo.module.css";
import auctionStyles from "../aukcje/[auctionId]/page.module.css";
import { PublicHeader } from "../components/public/PublicHeader";
import { SafeAuctionImage } from "../components/public/SafeAuctionImage";
import { DEMO_TURN_MS, demoAuctionStep, demoPrice, newDemoAuction } from "../../lib/demo-auction";

const COUNTDOWN_SECONDS = 5;
type DemoState = "countdown" | "live" | "queued" | "payment" | "won" | "lost";

type DemoProduct = {
  id: string;
  name: string;
  price: number;
  image: string | null;
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

function randomProduct(exceptId?: string) {
  const options = exceptId
    ? DEMO_PRODUCTS.filter((product) => product.id !== exceptId)
    : DEMO_PRODUCTS;
  return options[Math.floor(Math.random() * options.length)];
}

function formatSeconds(value: number) {
  const seconds = Math.max(0, Math.ceil(value));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
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

type DemoAuctionProps = {
  initialProduct?: DemoProduct;
  auctionHref: string;
  auctionLabel: string;
  auctionDetails?: string;
};

export function DemoAuction({ initialProduct = DEMO_PRODUCTS[0], auctionHref, auctionLabel, auctionDetails }: DemoAuctionProps) {
  const [simulation, setSimulation] = useState(() => newDemoAuction(Date.now()));
  const ownIndex = simulation.buyers.findIndex(buyer => buyer.id === "you");
  const state: DemoState = simulation.outcome ?? (simulation.now < simulation.startedAt ? "countdown" : ownIndex === 0 ? "payment" : ownIndex > 0 ? "queued" : "live");
  const elapsed = simulation.now < simulation.startedAt ? Math.max(0, 5 - (simulation.startedAt - simulation.now) / 1000) : Math.max(0, (simulation.now - simulation.startedAt) / 1000);
  const [blikCode, setBlikCode] = useState("");
  const [blikError, setBlikError] = useState("");
  const [runId, setRunId] = useState(0);
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [signupState, setSignupState] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [signupMessage, setSignupMessage] = useState("");
  const productRef = useRef(initialProduct);
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
    const timer = window.setInterval(() => {
      setSimulation(current => demoAuctionStep(current, { type: "tick", now: Date.now() }, productRef.current.price));
    }, 250);
    return () => window.clearInterval(timer);
  }, [runId]);

  useEffect(() => {
    if (simulation.outcome && !finishedRef.current) {
      finishedRef.current = true;
      track("demo_auction_finished", { outcome: simulation.outcome });
      if (trafficSessionRef.current) void fetch("/api/analytics/landing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "event", event: "demo_finished", sessionId: trafficSessionRef.current, source: trafficSourceRef.current }), keepalive: true }).catch(() => undefined);
    }
  }, [simulation]);

  const product = productRef.current;
  const liveElapsed = state === "countdown" ? 0 : elapsed;
  const ownBuyer = simulation.buyers.find(buyer => buyer.id === "you");
  const position = simulation.buyers.findIndex(buyer => buyer.id === "you") + 1;
  const price = simulation.soldPrice ?? ownBuyer?.price ?? demoPrice(product.price, liveElapsed * 1000);
  const turnRemaining = Math.max(0, ((simulation.buyers[0]?.claimedAt ?? simulation.now) + DEMO_TURN_MS - simulation.now) / 1000);
  const remaining = state === "countdown"
    ? COUNTDOWN_SECONDS - elapsed
    : 0;
  const floorPrice = demoPrice(product.price, Number.POSITIVE_INFINITY);
  const progress = (product.price - demoPrice(product.price, liveElapsed * 1000))
    / Math.max(1, product.price - floorPrice) * 100;

  const trackAuctionClick = () => {
    if (!trafficSessionRef.current) return;
    void fetch("/api/analytics/landing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "event", event: "first_auction_cta",
        sessionId: trafficSessionRef.current, source: trafficSourceRef.current,
      }),
      keepalive: true,
    }).catch(() => undefined);
  };

  const shareResult = async () => {
    const resultText = "Wynik demo Fiszy. " + (state === "won"
      ? `Nie wygrywa ten, kto czeka najdłużej. Wylicytowałem ${product.name} za ${price} zł. To nie była tylko cena. To była decyzja. Tak wygląda decyzja na Fiszy. Przywracamy emocje zakupów.`
      : `Nie wygrywa ten, kto czeka najdłużej. Zatrzymałem się przy ${price} zł. Tak wygląda decyzja na Fiszy. Przywracamy emocje zakupów.`);
    const productImage = await new Promise<HTMLImageElement | null>((resolve) => {
      if (!product.image || !product.image.startsWith("/") || product.image.startsWith("//")) return resolve(null);
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
      context.fillText(product.name, 540, 1285, 900);

      context.fillStyle = "rgba(255,255,255,.18)";
      context.fillRect(182, 1370, 716, 2);

      context.fillStyle = "#ffffff";
      context.font = "800 58px Arial, sans-serif";
      context.fillText("To nie była tylko cena.", 540, 1490);
      context.fillText("To była decyzja.", 540, 1565);

      context.fillStyle = "#c9adff";
      context.font = "700 38px Arial, sans-serif";
      context.fillText("WYNIK DEMO FISZY", 540, 1730);
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
      track("demo_result_shared", { product: product.id, price, outcome: state });
    } catch {
      // Zamknięcie panelu udostępniania nie jest błędem dla użytkownika.
    }
  };

  const restart = () => {
    productRef.current = randomProduct(productRef.current.id);
    finishedRef.current = false;
    setSimulation(newDemoAuction(Date.now()));
    setBlikCode("");
    setBlikError("");
    setRunId((current) => current + 1);
    track("demo_auction_restarted", { product: productRef.current.id });
  };

  const buy = () => {
    setSimulation(current => demoAuctionStep(current, { type: "join", now: Date.now() }, product.price));
  };
  const pay = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!/^[0-9]{6}$/.test(blikCode)) { setBlikError("Wpisz dowolne 6 cyfr."); return; }
    setBlikError("");
    setSimulation(current => demoAuctionStep(current, { type: "pay", now: Date.now(), code: blikCode }, product.price));
  };

  const submitSignup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedEmail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || !consent) {
      setSignupState("error");
      setSignupMessage(!consent ? "Zaznacz zgodę na wiadomości e-mail od Fiszy." : "Wpisz poprawny adres e-mail.");
      return;
    }
    setSignupState("submitting");
    setSignupMessage("");
    const source = trafficAttributionRef.current ?? landingAttribution();
    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail, consent: true, consentVersion: "email-marketing-v1-2026-11-13", source, traffic: { sessionId: trafficSessionRef.current, source: trafficSourceRef.current } }),
      });
      if (!response.ok) throw new Error("signup_failed");
      const result = await response.json().catch(() => null) as { created?: boolean } | null;
      setSignupState("success");
      setSignupMessage(result?.created === false ? "Ten adres jest już zapisany na wiadomości Fiszy." : "Zapisano na wiadomości Fiszy.");
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
      : state === "queued" ? "CZEKASZ W KOLEJCE" : state === "payment" ? "TWOJA KOLEJ" : "DEMO ZAKOŃCZONE";
  const message = state === "countdown"
    ? "Za chwilę cena zacznie spadać. Gdy ruszy — decyzja będzie należeć do Ciebie."
    : state === "live"
      ? "Cena właśnie spada. Kliknij, zanim ktoś zrobi to przed Tobą."
      : state === "won"
        ? `Byłeś pierwszy. W tym demo kupiłeś ${product.name} za ${price} zł.`
        : `Ktoś był szybszy i kupił ${product.name} za ${price} zł.`;

  return (
    <main className={auctionStyles.page}>
      <PublicHeader />
      <div className={auctionStyles.content}>
        <Link className={auctionStyles.backLink} href={auctionHref}>← Wróć do aukcji Fiszy</Link>
        <section className={auctionStyles.auctionShell} aria-labelledby="demo-title">
          <SafeAuctionImage src={product.image} alt={product.name} priority frameClassName={auctionStyles.visual} />
          <div className={auctionStyles.panel}>
            <div className={auctionStyles.topline}>
              <span className={styles.demoBadge}>Demo · bez płatności</span>
              <span className={auctionStyles.duration}>{status}</span>
            </div>
            <h1 className={auctionStyles.title} id="demo-title">{product.name}</h1>

            <div className={auctionStyles.priceArea}>
              <div className={auctionStyles.priceTopline}>
                <span className={auctionStyles.priceLabel}>{ownBuyer ? "Twoja zapisana cena" : "Cena w demo"}</span>
                <span>Cena startowa w demo {product.price} zł</span>
              </div>
              <span className={auctionStyles.currentPrice} aria-live="off">{price} zł</span>
              <div className={auctionStyles.progressTrack} aria-hidden="true">
                <div className={auctionStyles.progressBar} style={{ width: `${progress}%` }} />
              </div>
            </div>

            {(state === "countdown" || state === "live") && (
              <div className={auctionStyles.clockBox}>
                <div>
                  <span className={auctionStyles.clockLabel}>{state === "countdown" ? "Start aukcji za" : "Czas od startu"}</span>
                  <span className={auctionStyles.clock}>{formatSeconds(state === "countdown" ? remaining : liveElapsed)}</span>
                </div>
                <span className={auctionStyles.sync}>Czas i cena aktualizują się automatycznie.</span>
              </div>
            )}

            {state === "countdown" || state === "live" ? <p className={auctionStyles.message} aria-live="polite">{message}</p> : null}

            {(state === "queued" || state === "payment") && (
              <section className={styles.checkout} aria-label="Symulacja kolejki i płatności">
                <div className={styles.checkoutHeader}><span className={styles.checkoutBadge}>Tryb demo</span><span>Bez opłat</span></div>
                {state === "queued" ? <>
                  <h2>Jesteś {position}. w kolejce</h2>
                  <p>Cena <b>{price} zł</b> jest Twoja. Gdy osoby przed Tobą nie zapłacą, dostaniesz własne 2 minuty.</p>
                  <div className={styles.turnClock}><span>Czas osoby przed Tobą</span><strong>{formatSeconds(turnRemaining)}</strong></div>
                  <button className={styles.demoSecondary} type="button" onClick={() => setSimulation(current => demoAuctionStep(current, { type: "skip", now: Date.now() }, product.price))}>Pomiń oczekiwanie w demo →</button>
                </> : <>
                  <h2>Teraz Twój ruch.</h2>
                  <p>Twoja cena jest zarezerwowana. Potwierdź zakup, zanim skończy się czas.</p>
                  <div className={styles.turnClock}><span>Czas na płatność</span><strong role="timer">{formatSeconds(turnRemaining)}</strong></div>
                  <div className={styles.turnProgress} aria-hidden="true"><i style={{width: `${turnRemaining / 120 * 100}%`}} /></div>
                  <form onSubmit={pay}>
                    <label htmlFor="demo-blik" className={styles.blikLabel}><span>Kod BLIK</span><span>6 cyfr</span></label>
                    <input id="demo-blik" inputMode="numeric" autoComplete="off" pattern="[0-9]{6}" maxLength={6} value={blikCode} onChange={event => setBlikCode(event.target.value.replace(/\D/g, ""))} placeholder="••• •••" required aria-describedby="demo-blik-hint demo-blik-error" aria-invalid={Boolean(blikError)} />
                    <small id="demo-blik-hint" className={styles.fieldHint}>Wpisz dowolne 6 cyfr — to tylko demo. Nie używaj kodu z banku.</small>
                    {blikError && <p id="demo-blik-error" role="status">{blikError}</p>}
                    <button className={styles.demoPay} type="submit">Potwierdź w demo · {price} zł</button>
                  </form>
                </>}
                <div className={styles.auctionContinues}><span className={styles.liveDot} aria-hidden="true"/><p>Aukcja trwa · <b>{demoPrice(product.price, liveElapsed * 1000)} zł</b><small>Kończy ją dopiero potwierdzona płatność. Twoja cena pozostaje bez zmian.</small></p></div>
              </section>
            )}
            {state === "won" ? (
              <section className={styles.winnerCard} aria-live="assertive" aria-label={`Wygrałeś ${product.name} za ${price} zł`}>
                <span className={`${styles.confetti} ${styles.confettiOne}`} aria-hidden="true">✦</span>
                <span className={`${styles.confetti} ${styles.confettiTwo}`} aria-hidden="true">✦</span>
                <span className={`${styles.confetti} ${styles.confettiThree}`} aria-hidden="true">●</span>
                <span className={styles.winnerSpark} aria-hidden="true">✦</span>
                <p>Płatność w demo potwierdzona</p>
                <h2>Wygrałeś.</h2>
                <strong>{product.name} za {price} zł</strong>
                <span className={styles.winnerNote}>Twoja symulowana płatność zakończyła aukcję.</span>
                <div className={styles.timingResult}>
                  <span>Twój timing</span>
                  <strong>Kliknąłeś przy {price} zł.</strong>
                  <p>To wynik symulacji, bez rzeczywistego zakupu.</p>
                  <button type="button" onClick={shareResult}>Udostępnij kartę w Stories</button>
                </div>
              </section>
            ) : state === "live" ? (
              <>
                <div className={auctionStyles.desktopAction}>
                  <button className={auctionStyles.primaryButton} type="button" onClick={buy}>LICYTUJ! — {price} ZŁ</button>
                </div>
                <div className={auctionStyles.mobileAction}>
                  <button className={auctionStyles.primaryButton} type="button" onClick={buy}>LICYTUJ! — {price} ZŁ</button>
                </div>
              </>
            ) : state === "countdown" ? (
              <button className={auctionStyles.primaryButton} type="button" disabled>ZA CHWILĘ START</button>
            ) : state === "lost" ? (
              <section className={`${styles.winnerCard} ${styles.lostCard}`} aria-live="assertive" aria-label={`Ktoś był przed Tobą i kupił ${product.name} za ${price} zł`}>
                <span className={`${styles.confetti} ${styles.confettiOne}`} aria-hidden="true">✕</span>
                <span className={`${styles.confetti} ${styles.confettiTwo}`} aria-hidden="true">✕</span>
                <span className={styles.winnerSpark} aria-hidden="true">!</span>
                <p>Czas na płatność minął</p>
                <h2>Twoja tura minęła.</h2>
                <strong>{product.name} za {price} zł</strong>
                <span className={styles.winnerNote}>Nie opłaciłeś zakupu w ciągu swoich 2 minut. Kolejka przechodzi dalej.</span>
                <div className={styles.timingResult}>
                  <span>Twój timing</span>
                  <strong>Dotarłeś do {price} zł.</strong>
                  <p>To wynik symulacji, bez rzeczywistego zakupu.</p>
                  <button type="button" onClick={shareResult}>Udostępnij kartę w Stories</button>
                </div>
                <button className={styles.restartButton} type="button" onClick={restart}>Zagraj jeszcze raz</button>
              </section>
            ) : null}
            {(state === "won" || state === "lost") ? (
              <section className={`${styles.resultSignup} ${state === "lost" ? styles.resultSignupLost : ""}`} aria-label="Zapis na wiadomości Fiszy">
                <p>{state === "won" ? "Chcesz sprawdzić to naprawdę?" : "Następnym razem decyzja będzie należeć do Ciebie."}</p>
                <Link className={styles.joinButton} href={auctionHref} onClick={trackAuctionClick}>{auctionLabel}</Link>
                {auctionDetails && <p className={styles.auctionDetails}>{auctionDetails}</p>}
                <form className={styles.resultSignupForm} onSubmit={submitSignup}>
                  <input id="demo-email" type="email" inputMode="email" autoComplete="email" placeholder="Twój e-mail" value={email} onFocus={() => { if (!signupStartedRef.current && trafficSessionRef.current) { signupStartedRef.current = true; void fetch("/api/analytics/landing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "event", event: "signup_started", sessionId: trafficSessionRef.current, source: trafficSourceRef.current }), keepalive: true }).catch(() => undefined); } }} onChange={(event) => setEmail(event.target.value)} required maxLength={254} disabled={signupState === "submitting" || signupState === "success"} />
                  <button type="submit" disabled={signupState === "submitting" || signupState === "success"}>{signupState === "submitting" ? "ZAPISUJĘ…" : signupState === "success" ? "JESTEŚ NA LIŚCIE" : "ZAPISZ MNIE NA WIADOMOŚCI FISZY"}</button>
                  <label><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} disabled={signupState === "submitting" || signupState === "success"} /> <span>Chcę otrzymywać od Fiszy e-maile o aukcjach, ofertach i nowościach. Zgodę mogę wycofać w każdej chwili. <Link href="/prywatnosc">Polityka prywatności</Link></span></label>
                  {signupMessage ? <small className={signupState === "success" ? styles.signupSuccess : styles.signupError} aria-live="polite">{signupMessage}</small> : null}
                </form>
              </section>
            ) : null}
            {state === "won" && <button className={styles.restartButton} type="button" onClick={restart}>Spróbuj ponownie</button>}
            <p className={styles.note}>To symulacja. Niczego tutaj nie kupujesz ani nie płacisz.</p>
          </div>
        </section>
      </div>
    </main>
  );
}
