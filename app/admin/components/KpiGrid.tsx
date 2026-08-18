import type { AdminAuction, AdminOrder } from "../types";
import { formatMoney } from "../utils";
import styles from "../AdminDashboard.module.css";

type KpiGridProps = {
  auctions: AdminAuction[];
  orders: AdminOrder[];
};

export function KpiGrid({ auctions, orders }: KpiGridProps) {
  const live = auctions.filter((auction) => auction.status === "live").length;
  const newShipments = orders.filter(
    (order) => order.fulfillment.status === "new",
  ).length;
  const paidOrderValue = orders.reduce((total, order) => total + order.amount, 0);

  const values = [
    {
      label: "Wszystkie aukcje",
      value: auctions.length,
      hint: `${auctions.filter((auction) => auction.recordState === "archived").length} w archiwum`,
      tone: "neutral",
    },
    { label: "Live", value: live, hint: "aktywne teraz", tone: "live" },
    {
      label: "Nowe wysyłki",
      value: newShipments,
      hint: "wymagają obsługi",
      tone: "waiting",
    },
    {
      label: "Wartość zamówień",
      value: formatMoney(paidOrderValue),
      hint: `${orders.length} opłaconych produktów`,
      tone: "sold",
    },
  ] as const;

  return (
    <section className={styles.kpiGrid} aria-label="Podsumowanie operacyjne">
      {values.map((item) => (
        <article className={styles.kpiCard} key={item.label}>
          <span className={`${styles.kpiDot} ${styles[`kpiDot_${item.tone}`]}`} aria-hidden="true" />
          <span className={styles.kpiLabel}>{item.label}</span>
          <strong className={styles.kpiValue}>{item.value}</strong>
          <span className={styles.kpiHint}>{item.hint}</span>
        </article>
      ))}
    </section>
  );
}
