import type { AdminHealth } from "../types";
import styles from "../AdminDashboard.module.css";

type HealthPanelProps = {
  health: AdminHealth | null;
};

type HealthItem = {
  label: string;
  ready: boolean;
  detail: string;
};

export function HealthPanel({ health }: HealthPanelProps) {
  const items: HealthItem[] = health
    ? [
        {
          label: "Redis",
          ready: health.redisConfigured && health.redisReachable,
          detail:
            health.redisConfigured && health.redisReachable
              ? `Odpowiada${health.redisLatencyMs !== null ? ` · ${health.redisLatencyMs} ms` : ""}`
              : health.redisConfigured
                ? "Skonfigurowany, ale nie odpowiada"
                : "Brak połączenia",
        },
        {
          label: "Stripe",
          ready: health.stripeConfigured,
          detail: health.stripeConfigured
            ? health.stripeTestMode
              ? "Tryb testowy"
              : "Tryb płatności aktywny"
            : "Brak klucza",
        },
        {
          label: "Webhook",
          ready: health.webhookConfigured,
          detail: health.webhookConfigured ? "Sekret skonfigurowany" : "Brak sekretu",
        },
        {
          label: "Administrator",
          ready: health.adminConfigured && health.adminSecretStrong,
          detail:
            health.adminConfigured && health.adminSecretStrong
              ? "Silny sekret i sesja HttpOnly"
              : health.adminConfigured
                ? "Sekret wymaga wzmocnienia"
                : "Brak sekretu",
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
        <div className={styles.healthGrid}>
          {items.map((item) => (
            <div className={styles.healthItem} key={item.label}>
              <span
                className={item.ready ? styles.healthDotReady : styles.healthDotError}
                aria-hidden="true"
              />
              <div>
                <strong>{item.label}</strong>
                <span>{item.detail}</span>
              </div>
              <span className={styles.srOnly}>
                {item.ready ? "Skonfigurowane" : "Nieskonfigurowane"}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.emptyState}>
          <strong>Brak danych diagnostycznych</strong>
          <span>Użyj odświeżania, aby ponowić próbę.</span>
        </div>
      )}
    </section>
  );
}
