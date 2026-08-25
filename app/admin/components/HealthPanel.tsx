import { evaluateLaunchReadiness } from "../../../lib/launch-readiness";
import type { AdminAuction, AdminHealth } from "../types";
import styles from "../AdminDashboard.module.css";

type HealthPanelProps = {
  health: AdminHealth | null;
  auctions: AdminAuction[];
};

type HealthItem = {
  label: string;
  status: "ready" | "error" | "planned";
  detail: string;
};

export function HealthPanel({ health, auctions }: HealthPanelProps) {
  const readiness = health ? evaluateLaunchReadiness(health, auctions) : null;
  const providerName = health
    ? health.paymentProvider.toLowerCase() === "stripe"
      ? "Stripe"
      : health.paymentProvider.toLowerCase() === "przelewy24"
        ? "Przelewy24"
        : health.paymentProvider
    : "operator";
  const items: HealthItem[] = health
    ? [
        {
          label: "Redis",
          status: health.redisConfigured && health.redisReachable ? "ready" : "error",
          detail:
            health.redisConfigured && health.redisReachable
              ? `Odpowiada${health.redisLatencyMs !== null ? ` · ${health.redisLatencyMs} ms` : ""}`
              : health.redisConfigured
                ? "Skonfigurowany, ale nie odpowiada"
                : "Brak połączenia",
        },
        {
          label: "Operator płatności",
          status: health.paymentConfigured ? "ready" : "error",
          detail: health.paymentConfigured
            ? health.paymentTestMode
              ? `${providerName} · piaskownica`
              : `${providerName} · aktywny`
            : `${providerName} · brak konfiguracji`,
        },
        {
          label: "Potwierdzenia operatora",
          status: health.paymentWebhookConfigured ? "ready" : "error",
          detail: health.paymentWebhookConfigured
            ? "Kanał potwierdzeń skonfigurowany"
            : "Brak konfiguracji potwierdzeń",
        },
        {
          label: "Administrator",
          status: health.individualAdminAccountsConfigured || (health.adminConfigured && health.adminSecretStrong) ? "ready" : "planned",
          detail:
            health.individualAdminAccountsConfigured
              ? "Indywidualne konta Clerk i role administratorów"
              : health.adminConfigured && health.adminSecretStrong
                ? "Silny sekret i sesja HttpOnly"
              : health.adminConfigured
                ? "Wzmocnienie sekretu odłożone decyzją operatora"
                : "Brak sekretu",
        },
        {
          label: "Konta użytkowników",
          status: health.authenticationConfigured ? "ready" : "error",
          detail: health.authenticationConfigured ? "Clerk i logowanie gotowe" : "Brak konfiguracji Clerk",
        },
        {
          label: "Powiadomienia w portalu",
          status: health.inAppNotificationsConfigured ? "ready" : "error",
          detail: health.inAppNotificationsConfigured ? "Aktywne i zapamiętują odczyt" : "Brak konfiguracji",
        },
        {
          label: "Domena i SEO",
          status: health.canonicalSiteUrlExplicit ? "ready" : "planned",
          detail: health.canonicalSiteUrlExplicit
            ? health.canonicalSiteUrl ?? "Kanoniczny adres skonfigurowany"
            : "Działa na adresie Vercel; własna domena czeka na wybór",
        },
        {
          label: "E-mail transakcyjny",
          status: health.emailDeliveryConfigured && health.emailWebhookConfigured ? "ready" : "planned",
          detail: health.emailDeliveryConfigured && health.emailWebhookConfigured ? "Resend, nadawca i potwierdzenia dostarczenia gotowe" : health.emailDeliveryConfigured ? "Wysyłka działa; brakuje webhooka potwierdzeń" : "Czeka na zweryfikowaną domenę nadawcy",
        },
        {
          label: "Alerty zewnętrzne",
          status: health.externalErrorAlertsConfigured ? "ready" : "planned",
          detail: health.externalErrorAlertsConfigured ? "Codzienny monitoring i alert e-mail" : "Opcjonalna integracja do wyboru",
        },
      ]
    : [];

  return (
    <section className={styles.panelSection} aria-labelledby="health-heading">
      <div className={styles.sectionHeader}>
        <div>
          <p className={styles.eyebrow}>Diagnostyka</p>
          <h2 id="health-heading">Stan systemu</h2>
        </div>
        {health ? (
          <span className={health.degraded ? styles.healthDegraded : styles.healthReady}>
            {health.degraded ? "Wymaga uwagi" : "Gotowy"}
          </span>
        ) : null}
      </div>

      {health ? (
        <>
        <div className={styles.healthGrid}>
          {items.map((item) => (
            <div className={styles.healthItem} key={item.label}>
              <span
                className={item.status === "ready" ? styles.healthDotReady : item.status === "planned" ? styles.healthDotPlanned : styles.healthDotError}
                aria-hidden="true"
              />
              <div>
                <strong>{item.label}</strong>
                <span>{item.detail}</span>
              </div>
              <span className={styles.srOnly}>
                {item.status === "ready" ? "Skonfigurowane" : item.status === "planned" ? "Zaplanowane" : "Nieskonfigurowane"}
              </span>
            </div>
          ))}
        </div>
        {readiness ? (
          <div className={styles.readinessBlock}>
            <div className={styles.subpanelTitle}>
              <div>
                <p className={styles.eyebrow}>Brama przed startem</p>
                <h3>Gotowość pierwszej aukcji</h3>
              </div>
              <span className={readiness.status === "ready" ? styles.healthReady : styles.healthDegraded}>
                {readiness.status === "ready"
                  ? "Można startować"
                  : readiness.status === "warning"
                    ? `${readiness.warnings} ostrzeżenia`
                    : `${readiness.blockers} blokady`}
              </span>
            </div>
            <div className={styles.healthGrid}>
              {readiness.checks.map((check) => (
                <div className={styles.healthItem} key={check.id}>
                  <span className={check.status === "ready" ? styles.healthDotReady : check.status === "warning" ? styles.healthDotPlanned : styles.healthDotError} aria-hidden="true" />
                  <div><strong>{check.label}</strong><span>{check.detail}</span></div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        </>
      ) : (
        <div className={styles.emptyState}>
          <strong>Brak danych diagnostycznych</strong>
          <span>Użyj odświeżania, aby ponowić próbę.</span>
        </div>
      )}
    </section>
  );
}
