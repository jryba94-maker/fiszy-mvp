"use client";

import { useMemo, useState } from "react";
import type { AdminOrder } from "../types";
import {
  formatDateTime,
  formatMoney,
  orderAddress,
  shippingClipboardText,
} from "../utils";
import styles from "../AdminDashboard.module.css";

type OrdersPanelProps = {
  orders: AdminOrder[];
};

export function OrdersPanel({ orders }: OrdersPanelProps) {
  const [copiedOrderId, setCopiedOrderId] = useState<string | null>(null);
  const [copyError, setCopyError] = useState("");
  const sortedOrders = useMemo(
    () => [...orders].sort((left, right) => Date.parse(right.paidAt) - Date.parse(left.paidAt)),
    [orders],
  );

  const copyAddress = async (order: AdminOrder) => {
    const text = shippingClipboardText(order);
    if (!text) {
      setCopyError("To zamówienie nie zawiera danych dostawy.");
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      setCopiedOrderId(order.orderId);
      setCopyError("");
      window.setTimeout(() => setCopiedOrderId(null), 1800);
    } catch {
      setCopyError("Nie udało się skopiować adresu. Zaznacz dane ręcznie.");
    }
  };

  return (
    <section className={styles.panelSection} aria-labelledby="orders-heading">
      <div className={styles.sectionHeader}>
        <div>
          <p className={styles.eyebrow}>Realizacja</p>
          <h2 id="orders-heading">Ostatnie zamówienia</h2>
        </div>
        <span className={styles.sectionCount}>{orders.length}</span>
      </div>

      {copyError ? <p className={styles.errorNotice} role="alert">{copyError}</p> : null}

      {sortedOrders.length > 0 ? (
        <div className={styles.ordersList}>
          {sortedOrders.map((order) => (
            <article className={styles.orderCard} key={order.orderId}>
              <div className={styles.orderHeader}>
                <div>
                  <span className={styles.orderId}>{order.orderId}</span>
                  <h3>{order.product}</h3>
                </div>
                <strong className={styles.orderAmount}>
                  {formatMoney(order.amount, order.currency)}
                </strong>
              </div>

              <dl className={styles.orderMeta}>
                <div>
                  <dt>Opłacono</dt>
                  <dd>{formatDateTime(order.paidAt)}</dd>
                </div>
                <div>
                  <dt>Klient</dt>
                  <dd>{order.customer.name ?? "—"}</dd>
                </div>
                <div>
                  <dt>E-mail</dt>
                  <dd>
                    {order.customer.email ? (
                      <a href={`mailto:${order.customer.email}`}>{order.customer.email}</a>
                    ) : "—"}
                  </dd>
                </div>
                <div>
                  <dt>Telefon</dt>
                  <dd>
                    {order.customer.phone ? (
                      <a href={`tel:${order.customer.phone}`}>{order.customer.phone}</a>
                    ) : "—"}
                  </dd>
                </div>
                <div className={styles.orderAddress}>
                  <dt>Adres dostawy</dt>
                  <dd>{orderAddress(order)}</dd>
                </div>
              </dl>

              <div className={styles.orderActions}>
                <button
                  className={styles.secondaryButton}
                  type="button"
                  onClick={() => void copyAddress(order)}
                  disabled={!order.shippingAddress}
                  aria-live="polite"
                >
                  {copiedOrderId === order.orderId ? "SKOPIOWANO ✓" : "KOPIUJ DANE WYSYŁKI"}
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className={styles.emptyState}>
          <strong>Brak opłaconych zamówień</strong>
          <span>Pojawią się tutaj po potwierdzeniu płatności przez Stripe.</span>
        </div>
      )}
    </section>
  );
}
