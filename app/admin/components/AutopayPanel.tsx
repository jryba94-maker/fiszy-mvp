"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "../AdminDashboard.module.css";

type AutopayIssues = {
  stalePayments: Array<{ reference: string; status: string; createdAt: string; remoteId?: string; auctionId: string; runId: string }>;
  refundsRequiringAttention: Array<{ messageId: string; reference: string; state: string; amount: number; updatedAt: string }>;
  inspectedRecentPayments: number;
  inspectedRecentRefunds: number;
};

const statusLabels: Record<string, string> = {
  creating: "Tworzenie płatności",
  open: "Otwarte",
  processing: "Oczekuje na potwierdzenie",
  unknown: "Status nieustalony",
  requested: "Zwrot zgłoszony",
  submitted: "Zwrot wysłany do operatora",
  failed: "Zwrot nieudany",
};

const money = new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" });
const dateTime = new Intl.DateTimeFormat("pl-PL", {
  dateStyle: "short", timeStyle: "short", timeZone: "Europe/Warsaw",
});

export function AutopayPanel({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [data, setData] = useState<AutopayIssues | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/payments/autopay", { cache: "no-store" });
      if (response.status === 401) {
        onSessionExpired();
        return;
      }
      if (!response.ok) {
        setError(response.status === 403 ? "Brak uprawnień do diagnostyki płatności." : "Nie udało się pobrać diagnostyki Autopay.");
        return;
      }
      setData(await response.json() as AutopayIssues);
    } catch {
      setError("Nie udało się pobrać diagnostyki Autopay.");
    } finally {
      setLoading(false);
    }
  }, [onSessionExpired]);

  useEffect(() => { void load(); }, [load]);

  return (
    <section className={styles.panelSection} aria-labelledby="autopay-heading" aria-busy={loading}>
      <div className={styles.sectionHeader}>
        <h2 id="autopay-heading">Płatności Autopay</h2>
        <button className={styles.secondaryButton} type="button" disabled={loading} onClick={() => void load()}>Odśwież</button>
      </div>
      {loading ? <p role="status">Pobieram diagnostykę płatności…</p> : null}
      {error ? <p className={styles.errorNotice} role="alert">{error}{data ? " Poniżej ostatni pobrany wynik." : ""}</p> : null}
      {data ? <>
        <p>Sprawdzono {data.inspectedRecentPayments} ostatnich płatności i {data.inspectedRecentRefunds} ostatnich zwrotów. Raport obejmuje do 100 wpisów każdego typu.</p>
        <div className={styles.operationsColumns}>
          <div className={styles.adminSubpanel}>
            <h3>Płatności po terminie</h3>
            {data.stalePayments.length ? <ul className={styles.operationsList}>{data.stalePayments.map((payment) => (
              <li key={payment.reference} className={styles.operationCase}>
                <strong>{statusLabels[payment.status] ?? payment.status}</strong>
                <span>Utworzono {dateTime.format(new Date(payment.createdAt))}</span>
                <span>Aukcja {payment.auctionId} · runda {payment.runId}</span>
                <span>Fiszy {payment.reference}</span>
                {payment.remoteId ? <span>Autopay {payment.remoteId}</span> : null}
              </li>
            ))}</ul> : <p>Brak płatności po terminie w sprawdzonym zakresie.</p>}
          </div>
          <div className={styles.adminSubpanel}>
            <h3>Zwroty wymagające sprawdzenia</h3>
            {data.refundsRequiringAttention.length ? <ul className={styles.operationsList}>{data.refundsRequiringAttention.map((refund) => (
              <li key={refund.messageId} className={styles.operationCase}>
                <strong>{statusLabels[refund.state] ?? refund.state} · {money.format(refund.amount / 100)}</strong>
                <span>Aktualizacja {dateTime.format(new Date(refund.updatedAt))}</span>
                <span>Fiszy {refund.reference}</span>
                <span>Zwrot {refund.messageId}</span>
              </li>
            ))}</ul> : <p>Brak zwrotów wymagających sprawdzenia w tym zakresie.</p>}
          </div>
        </div>
      </> : null}
    </section>
  );
}
