"use client";

import { track } from "@vercel/analytics";
import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { LEGACY_AUCTION_ID } from "../public/auction-data";
import { latestPendingReturn } from "../public/device-history";
import styles from "./landing.module.css";

type SignupState = "idle" | "submitting" | "success" | "error";

function cleanTrackingValue(value: string | null) {
  return value?.trim().slice(0, 160) || null;
}

function trafficSource() {
  const params = new URLSearchParams(window.location.search);
  let referrerHost: string | null = null;
  try {
    referrerHost = document.referrer ? new URL(document.referrer).hostname.slice(0, 160) : null;
  } catch {
    referrerHost = null;
  }
  return {
    utmSource: cleanTrackingValue(params.get("utm_source")),
    utmMedium: cleanTrackingValue(params.get("utm_medium")),
    utmCampaign: cleanTrackingValue(params.get("utm_campaign")),
    utmContent: cleanTrackingValue(params.get("utm_content")),
    utmTerm: cleanTrackingValue(params.get("utm_term")),
    referrerHost,
  };
}

function analyticsProperties(source: ReturnType<typeof trafficSource>) {
  return {
    source: source.utmSource ?? "direct",
    medium: source.utmMedium ?? "none",
    campaign: source.utmCampaign ?? "none",
    referrer: source.referrerHost ?? "direct",
  };
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
  const sourceRef = useRef<ReturnType<typeof trafficSource> | null>(null);
  const startedTypingRef = useRef(false);

  useEffect(() => {
    if (redirectLegacyPaymentReturn()) return;
    const source = trafficSource();
    sourceRef.current = source;
    track("landing_view", analyticsProperties(source));

    const reported = new Set<number>();
    const reportScroll = () => {
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      const progress = scrollable <= 0 ? 100 : Math.round((window.scrollY / scrollable) * 100);
      for (const depth of [25, 50, 75, 100]) {
        if (progress >= depth && !reported.has(depth)) {
          reported.add(depth);
          track("landing_scroll_depth", { ...analyticsProperties(source), depth });
        }
      }
    };
    window.addEventListener("scroll", reportScroll, { passive: true });
    reportScroll();
    return () => window.removeEventListener("scroll", reportScroll);
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (state === "submitting" || state === "success") return;
    const source = sourceRef.current ?? trafficSource();
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
        body: JSON.stringify({ email: normalizedEmail, consent, source }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null) as { outcome?: string } | null;
        throw new Error(data?.outcome === "rate_limited" ? "rate_limited" : "signup_failed");
      }
      setState("success");
      setMessage("Damy Ci znać przed pierwszym startem.");
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
      const source = sourceRef.current ?? trafficSource();
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

          {state === "success" ? (
            <div className={styles.success} role="status" tabIndex={-1}>
              <span aria-hidden="true">✓</span>
              <div><strong>Jesteś na liście.</strong><p>{message}</p></div>
            </div>
          ) : (
            <form className={styles.form} onSubmit={handleSubmit} noValidate>
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
                      const source = sourceRef.current ?? trafficSource();
                      track("waitlist_email_focus", analyticsProperties(source));
                    }}
                    onChange={(event) => handleInput(event.target.value)}
                  />
                </label>
                <button type="submit" disabled={state === "submitting"} aria-busy={state === "submitting"}>
                  <span>{state === "submitting" ? "Zapisuję…" : "Chcę wiedzieć pierwszy"}</span>
                  <b aria-hidden="true">↗</b>
                </button>
              </div>
              <label className={styles.consent}>
                <input type="checkbox" checked={consent} required onChange={(event) => setConsent(event.target.checked)} />
                <span>
                  Chcę otrzymać e-mail o starcie pierwszej aukcji. Zgodę mogę wycofać w każdej chwili. Szczegóły w <Link href="/prywatnosc">polityce prywatności</Link>.
                </span>
              </label>
              <p id="waitlist-note" className={styles.formNote}>Bez spamu. Jedna wiadomość, kiedy nadejdzie właściwy moment.</p>
              <p id="waitlist-message" className={styles.error} role="alert">{state === "error" ? message : ""}</p>
            </form>
          )}
        </div>
      </section>

    </main>
  );
}
