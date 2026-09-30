"use client";

import { track } from "@vercel/analytics";
import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { landingAttribution, landingSourceLabel } from "../../../lib/landing-attribution";
import { LEGACY_AUCTION_ID } from "../public/auction-data";
import { latestPendingReturn } from "../public/device-history";
import styles from "./landing.module.css";

type SignupState = "idle" | "submitting" | "success" | "error";

function analyticsProperties(source: ReturnType<typeof landingAttribution>) {
  return {
    source: source.utmSource ?? "direct",
    medium: source.utmMedium ?? "none",
    campaign: source.utmCampaign ?? "none",
    referrer: source.referrerHost ?? "direct",
  };
}

function landingVisitorId() {
  try {
    const key = "fiszy_landing_visitor_id";
    const saved = localStorage.getItem(key);
    if (saved && /^[a-f0-9-]{36}$/i.test(saved)) return saved;
    const id = crypto.randomUUID();
    localStorage.setItem(key, id);
    return id;
  } catch { return crypto.randomUUID(); }
}

function landingSessionId() {
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

function redirectLegacyPaymentReturn() {
  const params = new URLSearchParams(window.location.search);
  const kind = params.has("payment") ? "payment" : params.has("purchase") ? "purchase" : null;
  if (!kind) return false;
  const value = params.get(kind);
  if (!value) return false;
  const record = latestPendingReturn(kind);
  const href = record?.href ?? `/aukcje/${LEGACY_AUCTION_ID}`;
  window.location.replace(`${href}?${kind}=${encodeURIComponent(value)}`);
  return true;
}

export function WaitlistLanding() {
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState<SignupState>("idle");
  const [message, setMessage] = useState("");
  const [signupOpen, setSignupOpen] = useState(false);
  const [demoCount, setDemoCount] = useState<number | null>(null);
  const sourceRef = useRef<ReturnType<typeof landingAttribution> | null>(null);
  const startedTypingRef = useRef(false);
  const landingSessionRef = useRef("");

  const reportTraffic = (payload: Record<string, unknown>, beacon = false) => {
    const body = JSON.stringify(payload);
    if (beacon && navigator.sendBeacon) {
      navigator.sendBeacon("/api/analytics/landing", new Blob([body], { type: "application/json" }));
      return;
    }
    void fetch("/api/analytics/landing", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => undefined);
  };

  useEffect(() => {
    if (redirectLegacyPaymentReturn()) return;
    const source = landingAttribution();
    sourceRef.current = source;
    const sourceLabel = landingSourceLabel(source);
    const sessionId = landingSessionId();
    const viewId = crypto.randomUUID();
    const durationId = crypto.randomUUID();
    landingSessionRef.current = sessionId;
    reportTraffic({ type: "view", page: "landing", sessionId, viewId, visitorId: landingVisitorId(), source: sourceLabel });
    track("landing_view", analyticsProperties(source));

    const reportedTrafficEvents = new Set<string>();
    const reportEvent = (event: "scroll_25" | "scroll_50" | "scroll_75" | "scroll_100" | "form_started" | "cta_attempt" | "demo_opened" | "signup_started") => {
      if (reportedTrafficEvents.has(event)) return;
      reportedTrafficEvents.add(event);
      reportTraffic({ type: "event", sessionId, source: sourceLabel, event });
    };
    const startedAt = performance.now();
    let visibleStartedAt = startedAt;
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
      reportTraffic({ type: "duration", sessionId, durationId, source: sourceLabel, seconds: Math.round(activeMs / 1000) }, true);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", reportDuration);

    const reported = new Set<number>();
    const reportScroll = () => {
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      const progress = scrollable <= 0 ? 100 : Math.round((window.scrollY / scrollable) * 100);
      for (const depth of [25, 50, 75, 100]) {
        if (progress >= depth && !reported.has(depth)) {
          reported.add(depth);
          reportEvent(`scroll_${depth}` as "scroll_25" | "scroll_50" | "scroll_75" | "scroll_100");
          track("landing_scroll_depth", { ...analyticsProperties(source), depth });
        }
      }
    };
    window.addEventListener("scroll", reportScroll, { passive: true });
    reportScroll();
    return () => {
      window.removeEventListener("scroll", reportScroll);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pagehide", reportDuration);
      reportDuration();
    };
  }, []);


  useEffect(() => {
    let frame = 0;
    let cancelled = false;
    void fetch("/api/analytics/landing", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<{ demoOpened?: unknown }> : null)
      .then((payload) => {
        const target = typeof payload?.demoOpened === "number" && Number.isSafeInteger(payload.demoOpened)
          ? Math.max(0, payload.demoOpened)
          : null;
        if (target === null || cancelled) return;
        const from = Math.max(0, target - 10);
        const startedAt = performance.now();
        const tick = (now: number) => {
          const progress = Math.min(1, (now - startedAt) / 10_000);
          setDemoCount(Math.round(from + (target - from) * (1 - Math.pow(1 - progress, 3))));
          if (progress < 1 && !cancelled) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      })
      .catch(() => undefined);
    return () => { cancelled = true; cancelAnimationFrame(frame); };
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (state === "submitting" || state === "success") return;
    const source = sourceRef.current ?? landingAttribution();
    const sourceLabel = landingSourceLabel(source);
    reportTraffic({ type: "event", sessionId: landingSessionRef.current, source: sourceLabel, event: "cta_attempt" });
    track("waitlist_cta_click", analyticsProperties(source));
    const normalizedEmail = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || !consent) {
      setState("error");
      setMessage(!consent
        ? "Zaznacz zgodę, aby dołączyć do listy."
        : "Wpisz poprawny adres e-mail.");
      track("waitlist_signup_error", {
        ...analyticsProperties(source),
        reason: !consent ? "consent_missing" : "invalid_email",
      });
      return;
    }
    setState("submitting");
    setMessage("");
    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: normalizedEmail, consent, source, traffic: { sessionId: landingSessionRef.current, source: sourceLabel } }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { outcome?: string } | null;
        throw new Error(data?.outcome === "rate_limited" ? "rate_limited" : "signup_failed");
      }
      const result = await response.json().catch(() => null) as { created?: boolean } | null;
      setState("success");
      setMessage(result?.created === false ? "Ten adres jest już na liście." : "Damy Ci znać przed pierwszym startem.");
      track("waitlist_signup_success", analyticsProperties(source));
    } catch (error) {
      const rateLimited = error instanceof Error && error.message === "rate_limited";
      setState("error");
      setMessage(rateLimited
        ? "Za dużo prób. Odczekaj chwilę i spróbuj ponownie."
        : "Nie udało się zapisać. Spróbuj ponownie za chwilę.");
      track("waitlist_signup_error", {
        ...analyticsProperties(source),
        reason: rateLimited ? "rate_limited" : "request_failed",
      });
    }
  };

  const handleInput = (value: string) => {
    setEmail(value);
    if (!startedTypingRef.current && value.length > 0) {
      startedTypingRef.current = true;
      const source = sourceRef.current ?? landingAttribution();
      const sourceLabel = landingSourceLabel(source);
      reportTraffic({ type: "event", sessionId: landingSessionRef.current, source: sourceLabel, event: "form_started" });
      reportTraffic({ type: "event", sessionId: landingSessionRef.current, source: sourceLabel, event: "signup_started" });
      track("waitlist_email_input_started", analyticsProperties(source));
    }
  };

  return (
    <main className={styles.page}>
      <section className={styles.hero} aria-labelledby="landing-title">
        <div className={styles.heroGlow} aria-hidden="true" />
        <header className={styles.header}>
          <Link className={styles.logo} href="/" aria-label="Fiszy — strona główna">
            Fiszy<span>.</span>
          </Link>
          <span className={styles.launchBadge}><i aria-hidden="true" /> Pierwszy start</span>
        </header>

        <div className={styles.heroContent}>
          <div className={styles.orbit} aria-hidden="true">
            <span className={styles.orbitCore} />
            <span className={styles.orbitRing} />
          </div>
          <p className={styles.eyebrow}>Odkryj nowy sposób kupowania</p>
          <h1 id="landing-title">Coś zacznie <em>spadać.</em></h1>
          <p className={styles.lead}>
            <strong>Poczekasz dłużej — zapłacisz mniej.</strong><br />
            Tylko jak długo możesz czekać?
          </p>
          <Link className={styles.demoButton} href="/demo" onClick={() => { const source = sourceRef.current ?? landingAttribution(); reportTraffic({ type: "event", sessionId: landingSessionRef.current, source: landingSourceLabel(source), event: "demo_opened" }); track("landing_demo_click", analyticsProperties(source)); }}>
            <span className={styles.demoButtonIcon} aria-hidden="true">▶</span>
            <span><small>Nie wiesz, kiedy kliknąć?</small>Zagraj w demo aukcji</span>
            <b aria-hidden="true">↗</b>
          </Link>
          <div className={styles.demoProof} aria-label="Informacja o zainteresowaniu">
            <span><strong>{demoCount === null ? "…" : demoCount.toLocaleString("pl-PL")}</strong> osób już sprawdziło demo.</span>
            <span>Lista pierwszej aukcji jest otwarta.</span>
          </div>
          <div className={styles.eventFormat} aria-label="Format pierwszej aukcji">
            <span>1 produkt</span><i aria-hidden="true">·</i><span>1 godzina</span><i aria-hidden="true">·</i><span>Najniższa cena</span>
          </div>

          {state === "success" ? (
            <div className={styles.success} role="status" tabIndex={-1}>
              <span aria-hidden="true">✓</span>
              <div><strong>Jesteś na liście.</strong><p>{message}</p></div>
            </div>
          ) : signupOpen ? (
            <form className={styles.form} id="zapis" onSubmit={handleSubmit} noValidate>
              <div className={styles.formRow}>
                <label className={styles.emailField}>
                  <input
                    type="email"
                    name="email"
                    aria-label="Adres e-mail"
                    inputMode="email"
                    autoComplete="email"
                    placeholder="Zostaw swój e-mail"
                    value={email}
                    required
                    maxLength={254}
                    aria-describedby="waitlist-note waitlist-message"
                    onFocus={() => {
                      const source = sourceRef.current ?? landingAttribution();
                      track("waitlist_email_focus", analyticsProperties(source));
                    }}
                    onChange={(event) => handleInput(event.target.value)}
                  />
                </label>
                <button type="submit" disabled={state === "submitting"} aria-busy={state === "submitting"}>
                  <span>{state === "submitting" ? "Zapisuję…" : "Zapisz mnie na pierwszą aukcję"}</span>
                  <b aria-hidden="true">↗</b>
                </button>
              </div>
              <label className={styles.consent}>
                <input type="checkbox" checked={consent} required onChange={(event) => setConsent(event.target.checked)} />
                <span>
                  Chcę otrzymać e-mail o starcie pierwszej aukcji. Zgodę mogę wycofać w każdej chwili. Szczegóły w <Link href="/prywatnosc" target="_blank" rel="noopener noreferrer">polityce prywatności</Link>.
                </span>
              </label>
              <p id="waitlist-note" className={styles.formNote}>Tylko informacje o pierwszej aukcji. Bez codziennych maili.</p>
              <p id="waitlist-message" className={styles.error} role="alert">{state === "error" ? message : ""}</p>
            </form>
          ) : (
            <button className={styles.secondaryJoin} type="button" onClick={() => setSignupOpen(true)}>
              Wiem, jak to działa — chcę być na pierwszej aukcji
            </button>
          )}
        </div>
      </section>

      <footer className={styles.footer}>
        <p><strong>Fiszy.</strong> Przywracamy emocje zakupów.</p>
        <nav aria-label="Informacje o Fiszy">
          <Link href="/jak-to-dziala">Jak to działa</Link>
          <Link href="/aukcja-holenderska">Aukcja holenderska</Link>
          <Link href="/o-fiszy">O Fiszy</Link>
          <Link href="/faq">FAQ</Link>
        </nav>
      </footer>

    </main>
  );
}
