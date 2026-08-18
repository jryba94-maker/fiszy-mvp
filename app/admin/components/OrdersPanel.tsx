"use client";

import {
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import type {
  AdminOrder,
  FulfillmentStatus,
  FulfillmentUpdateInput,
} from "../types";
import {
  FULFILLMENT_LABELS,
  downloadCsv,
  formatDateTime,
  formatMoney,
  matchesOrderSearch,
  orderAddress,
  ordersCsv,
  shippingClipboardText,
} from "../utils";
import styles from "../AdminDashboard.module.css";

const FULFILLMENT_FILTERS: Array<{
  value: "all" | FulfillmentStatus;
  label: string;
}> = [
  { value: "all", label: "Wszystkie statusy" },
  { value: "new", label: FULFILLMENT_LABELS.new },
  { value: "preparing", label: FULFILLMENT_LABELS.preparing },
  { value: "shipped", label: FULFILLMENT_LABELS.shipped },
  { value: "delivered", label: FULFILLMENT_LABELS.delivered },
];

const ALLOWED_FULFILLMENT_TRANSITIONS: Record<
  FulfillmentStatus,
  readonly FulfillmentStatus[]
> = {
  new: ["new", "preparing", "shipped"],
  preparing: ["new", "preparing", "shipped"],
  shipped: ["preparing", "shipped", "delivered"],
  delivered: ["shipped", "delivered"],
};

type OrdersPanelProps = {
  orders: AdminOrder[];
  busyOrderId: string | null;
  updateError: { orderId: string; message: string } | null;
  onUpdateFulfillment: (
    order: AdminOrder,
    input: FulfillmentUpdateInput,
  ) => Promise<boolean>;
};

type FulfillmentDraft = {
  status: FulfillmentStatus;
  carrier: string;
  trackingNumber: string;
  note: string;
};

function draftFromOrder(order: AdminOrder): FulfillmentDraft {
  return {
    status: order.fulfillment.status,
    carrier: order.fulfillment.carrier ?? "",
    trackingNumber: order.fulfillment.trackingNumber ?? "",
    note: order.fulfillment.note ?? "",
  };
}

function OrderCard({
  order,
  busy,
  updateError,
  onUpdateFulfillment,
}: {
  order: AdminOrder;
  busy: boolean;
  updateError: string | null;
  onUpdateFulfillment: OrdersPanelProps["onUpdateFulfillment"];
}) {
  const formId = useId();
  const [draft, setDraft] = useState(() => draftFromOrder(order));
  const [localError, setLocalError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setDraft(draftFromOrder(order));
  }, [
    order.fulfillment.carrier,
    order.fulfillment.note,
    order.fulfillment.revision,
    order.fulfillment.status,
    order.fulfillment.trackingNumber,
  ]);

  const unchanged =
    draft.status === order.fulfillment.status &&
    draft.carrier.trim() === (order.fulfillment.carrier ?? "") &&
    draft.trackingNumber.trim() === (order.fulfillment.trackingNumber ?? "") &&
    draft.note.trim() === (order.fulfillment.note ?? "");

  const copyAddress = async () => {
    const text = shippingClipboardText(order);
    if (!text) {
      setLocalError("To zamówienie nie zawiera danych dostawy.");
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setLocalError("");
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setLocalError("Nie udało się skopiować adresu. Zaznacz dane ręcznie.");
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || unchanged) return;

    const carrier = draft.carrier.trim();
    const trackingNumber = draft.trackingNumber.trim();
    const note = draft.note.trim();
    if (carrier.length > 80 || trackingNumber.length > 120 || note.length > 500) {
      setLocalError("Przewoźnik, numer przesyłki lub notatka są zbyt długie.");
      return;
    }
    if (Boolean(carrier) !== Boolean(trackingNumber)) {
      setLocalError("Podaj jednocześnie przewoźnika i numer przesyłki.");
      return;
    }
    if (
      (draft.status === "shipped" || draft.status === "delivered") &&
      (!carrier || !trackingNumber)
    ) {
      setLocalError("Status wysłane lub dostarczone wymaga danych przesyłki.");
      return;
    }

    setLocalError("");
    await onUpdateFulfillment(order, {
      expectedRevision: order.fulfillment.revision,
      status: draft.status,
      carrier: carrier || null,
      trackingNumber: trackingNumber || null,
      note: note || null,
    });
  };

  const error = localError || updateError;

  return (
    <article className={styles.orderCard}>
      <div className={styles.orderHeader}>
        <div>
          <span className={styles.orderId}>{order.orderId}</span>
          {order.orderKind === "post_auction_discount" ? (
            <span className={styles.discountOrderPill}>Zakup po aukcji</span>
          ) : null}
          <h3>{order.product}</h3>
        </div>
        <div className={styles.orderHeadlineMeta}>
          <strong className={styles.orderAmount}>
            {formatMoney(order.amount, order.currency)}
          </strong>
          <span className={`${styles.fulfillmentPill} ${styles[`fulfillment_${order.fulfillment.status}`]}`}>
            {FULFILLMENT_LABELS[order.fulfillment.status]}
          </span>
        </div>
      </div>

      <dl className={styles.orderMeta}>
        <div>
          <dt>Opłacono</dt>
          <dd>{formatDateTime(order.paidAt)}</dd>
        </div>
        {order.orderKind === "post_auction_discount" ? (
          <div>
            <dt>Rabat po aukcji</dt>
            <dd>
              {order.regularPrice !== null && order.discountAmount !== null
                ? `${formatMoney(order.regularPrice, order.currency)} − ${formatMoney(order.discountAmount, order.currency)}`
                : "Zastosowany"}
            </dd>
          </div>
        ) : null}
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

      <form className={styles.fulfillmentForm} onSubmit={handleSubmit} aria-busy={busy}>
        <fieldset disabled={busy} aria-describedby={error ? `${formId}-error` : undefined}>
          <legend>Realizacja wysyłki</legend>
          <div className={styles.fulfillmentGrid}>
            <label className={styles.field} htmlFor={`${formId}-status`}>
              <span>Status</span>
              <select
                id={`${formId}-status`}
                className={styles.input}
                value={draft.status}
                onChange={(event) => setDraft((current) => ({
                  ...current,
                  status: event.target.value as FulfillmentStatus,
                }))}
              >
                {FULFILLMENT_FILTERS.slice(1).map((item) => (
                  <option
                    key={item.value}
                    value={item.value}
                    disabled={!ALLOWED_FULFILLMENT_TRANSITIONS[
                      order.fulfillment.status
                    ].includes(item.value as FulfillmentStatus)}
                  >
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field} htmlFor={`${formId}-carrier`}>
              <span>Przewoźnik</span>
              <input
                id={`${formId}-carrier`}
                className={styles.input}
                value={draft.carrier}
                onChange={(event) => setDraft((current) => ({
                  ...current,
                  carrier: event.target.value,
                }))}
                maxLength={80}
                placeholder="np. InPost"
              />
            </label>
            <label className={`${styles.field} ${styles.fieldWide}`} htmlFor={`${formId}-tracking`}>
              <span>Numer przesyłki</span>
              <input
                id={`${formId}-tracking`}
                className={styles.input}
                value={draft.trackingNumber}
                onChange={(event) => setDraft((current) => ({
                  ...current,
                  trackingNumber: event.target.value,
                }))}
                maxLength={120}
                autoComplete="off"
                placeholder="Numer nadany przez przewoźnika"
              />
            </label>
            <label className={`${styles.field} ${styles.fieldWide}`} htmlFor={`${formId}-note`}>
              <span>Notatka wewnętrzna</span>
              <textarea
                id={`${formId}-note`}
                className={`${styles.input} ${styles.textarea}`}
                value={draft.note}
                onChange={(event) => setDraft((current) => ({
                  ...current,
                  note: event.target.value,
                }))}
                maxLength={500}
                rows={3}
                placeholder="Informacja dla zespołu realizacji"
              />
            </label>
          </div>
        </fieldset>

        {error ? (
          <p className={styles.errorNotice} id={`${formId}-error`} role="alert">
            {error}
          </p>
        ) : null}

        <div className={styles.orderActions}>
          <span className={styles.fulfillmentUpdated}>
            Aktualizacja: {formatDateTime(order.fulfillment.updatedAt)}
          </span>
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={() => void copyAddress()}
            disabled={!order.shippingAddress || busy}
          >
            {copied ? "Skopiowano ✓" : "Kopiuj adres"}
          </button>
          <button
            className={styles.cardPrimaryButton}
            type="submit"
            disabled={busy || unchanged}
            aria-busy={busy}
          >
            {busy ? "Zapisuję…" : "Zapisz realizację"}
          </button>
        </div>
      </form>
    </article>
  );
}

export function OrdersPanel({
  orders,
  busyOrderId,
  updateError,
  onUpdateFulfillment,
}: OrdersPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | FulfillmentStatus>("all");
  const deferredSearch = useDeferredValue(searchQuery);
  const filteredOrders = useMemo(
    () => [...orders]
      .sort((left, right) => Date.parse(right.paidAt) - Date.parse(left.paidAt))
      .filter((order) =>
        (statusFilter === "all" || order.fulfillment.status === statusFilter) &&
        matchesOrderSearch(order, deferredSearch),
      ),
    [deferredSearch, orders, statusFilter],
  );

  const exportOrders = () => {
    const day = new Date().toISOString().slice(0, 10);
    downloadCsv(ordersCsv(filteredOrders), `fiszy-zamowienia-${day}.csv`);
  };

  return (
    <section className={styles.panelSection} aria-labelledby="orders-heading">
      <div className={styles.sectionHeader}>
        <div>
          <p className={styles.eyebrow}>Realizacja</p>
          <h2 id="orders-heading">Zamówienia i wysyłki</h2>
        </div>
        <span className={styles.sectionCount} aria-label={`${orders.length} zamówień`}>
          {orders.length}
        </span>
      </div>

      <div className={styles.listToolbar}>
        <label className={styles.searchField} htmlFor="order-search">
          <span className={styles.srOnly}>Szukaj zamówienia</span>
          <input
            id="order-search"
            className={styles.input}
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Szukaj zamówienia, klienta lub przesyłki…"
            autoComplete="off"
          />
        </label>
        <label className={styles.compactField} htmlFor="fulfillment-filter">
          <span className={styles.srOnly}>Filtruj status realizacji</span>
          <select
            id="fulfillment-filter"
            className={styles.input}
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as "all" | FulfillmentStatus)}
          >
            {FULFILLMENT_FILTERS.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </label>
        <button
          className={styles.secondaryButton}
          type="button"
          onClick={exportOrders}
          disabled={filteredOrders.length === 0}
        >
          Eksportuj widok CSV
        </button>
      </div>

      <p className={styles.resultSummary} aria-live="polite">
        Pokazano {filteredOrders.length} z {orders.length} zamówień.
      </p>

      {filteredOrders.length > 0 ? (
        <div className={styles.ordersList}>
          {filteredOrders.map((order) => (
            <OrderCard
              key={order.orderId}
              order={order}
              busy={busyOrderId === order.orderId}
              updateError={updateError?.orderId === order.orderId ? updateError.message : null}
              onUpdateFulfillment={onUpdateFulfillment}
            />
          ))}
        </div>
      ) : (
        <div className={styles.emptyState}>
          <strong>Brak zamówień w tym widoku</strong>
          <span>Zmień wyszukiwanie lub filtr statusu realizacji.</span>
        </div>
      )}
    </section>
  );
}
