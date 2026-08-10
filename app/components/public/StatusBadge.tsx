import type { AuctionStatus } from "./auction-data";
import styles from "./public.module.css";

const STATUS_LABELS: Record<AuctionStatus, string> = {
  waiting: "Nadchodząca",
  live: "Trwa teraz",
  payment_pending: "Rezerwacja",
  sold: "Sprzedana",
  ended: "Zakończona",
};

export function statusLabel(status: AuctionStatus) {
  return STATUS_LABELS[status];
}

export function StatusBadge({ status }: { status: AuctionStatus }) {
  const tone = status === "live"
    ? styles.statusLive
    : status === "waiting"
      ? styles.statusWaiting
      : status === "payment_pending"
        ? styles.statusPending
        : styles.statusFinal;

  return <span className={`${styles.statusBadge} ${tone}`}>{statusLabel(status)}</span>;
}
