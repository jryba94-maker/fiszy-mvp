import type { AdminAuction } from "../types";
import styles from "../AdminDashboard.module.css";

type KpiGridProps = {
  auctions: AdminAuction[];
};

export function KpiGrid({ auctions }: KpiGridProps) {
  const live = auctions.filter((auction) => auction.status === "live").length;
  const waiting = auctions.filter((auction) => auction.status === "waiting").length;
  const sold = auctions.filter((auction) => auction.status === "sold").length;

  const values = [
    { label: "Łącznie", value: auctions.length, tone: "neutral" },
    { label: "Live", value: live, tone: "live" },
    { label: "Oczekujące", value: waiting, tone: "waiting" },
    { label: "Sprzedane", value: sold, tone: "sold" },
  ] as const;

  return (
    <section className={styles.kpiGrid} aria-label="Podsumowanie aukcji">
      {values.map((item) => (
        <article className={styles.kpiCard} key={item.label}>
          <span className={`${styles.kpiDot} ${styles[`kpiDot_${item.tone}`]}`} aria-hidden="true" />
          <span className={styles.kpiLabel}>{item.label}</span>
          <strong className={styles.kpiValue}>{item.value}</strong>
        </article>
      ))}
    </section>
  );
}
