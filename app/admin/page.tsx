"use client";

import { useEffect, useState } from "react";

type AuctionState = {
  runId: string;
  status: "waiting" | "live" | "ended" | "payment_pending" | "sold";
  currentPrice: number;
  startsAt: string;
  endsAt: string;
};

type StartResponse = {
  outcome:
    | "scheduled"
    | "unauthorized"
    | "admin_not_configured"
    | "pending_payment"
    | "storage_error";
  startsAt?: string;
};

type Order = {
  orderId: string;
  runId: string;
  bidderId: string;
  product: string;
  amount: number;
  currency: "pln";
  paymentSessionId: string;
  paidAt: string;
  customer: {
    name: string | null;
    email: string | null;
    phone: string | null;
  };
  shippingAddress: {
    city: string | null;
    country: string | null;
    line1: string | null;
    line2: string | null;
    postalCode: string | null;
    state: string | null;
  } | null;
};

type OrderResponse = {
  outcome: "ok" | "unauthorized" | "admin_not_configured" | "storage_error";
  order?: Order | null;
};

function formatDateTime(value?: string) {
  if (!value) return "—";

  return new Date(value).toLocaleString("pl-PL", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    day: "2-digit",
    month: "2-digit",
  });
}

function formatAddress(order: Order | null) {
  const address = order?.shippingAddress;
  if (!address) return "—";

  const street = [address.line1, address.line2].filter(Boolean).join(", ");
  const city = [address.postalCode, address.city].filter(Boolean).join(" ");
  return [street, city, address.country].filter(Boolean).join(" · ") || "—";
}

export default function AdminPage() {
  const [auction, setAuction] = useState<AuctionState | null>(null);
  const [adminKey, setAdminKey] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  const [message, setMessage] = useState("");
  const [order, setOrder] = useState<Order | null>(null);
  const [isLoadingOrder, setIsLoadingOrder] = useState(false);
  const [orderMessage, setOrderMessage] = useState("");

  const loadAuction = async () => {
    try {
      const response = await fetch("/api/auction", { cache: "no-store" });
      if (!response.ok) return;
      setAuction((await response.json()) as AuctionState);
    } catch {
      // Status is informational only; starting the auction still has its own error handling.
    }
  };

  useEffect(() => {
    void loadAuction();
    const timer = window.setInterval(() => void loadAuction(), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const loadOrder = async () => {
    if (!adminKey || isLoadingOrder) return;

    setIsLoadingOrder(true);
    setOrderMessage("");

    try {
      const response = await fetch("/api/admin/order", {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${adminKey}`,
        },
      });
      const data = (await response.json()) as OrderResponse;

      if (data.outcome === "ok") {
        setOrder(data.order ?? null);
        setOrderMessage(
          data.order
            ? "Zamówienie pobrane z Redis."
            : "Ta sesja aukcji nie ma jeszcze opłaconego zamówienia.",
        );
      } else if (data.outcome === "unauthorized") {
        setOrder(null);
        setOrderMessage("Nieprawidłowy sekret administratora.");
      } else {
        setOrder(null);
        setOrderMessage("Nie udało się pobrać zamówienia.");
      }
    } catch {
      setOrder(null);
      setOrderMessage("Nie udało się połączyć z endpointem zamówienia.");
    } finally {
      setIsLoadingOrder(false);
    }
  };

  const startAuction = async () => {
    if (!adminKey || isStarting) return;

    setIsStarting(true);
    setMessage("");

    try {
      const response = await fetch("/api/admin/auction/start", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${adminKey}`,
        },
      });
      const data = (await response.json()) as StartResponse;

      if (data.outcome === "scheduled") {
        setMessage(`Nowa aukcja zaplanowana na ${formatDateTime(data.startsAt)}.`);
        setOrder(null);
        setOrderMessage("");
        await loadAuction();
      } else if (data.outcome === "unauthorized") {
        setMessage("Nieprawidłowy sekret administratora.");
      } else if (data.outcome === "admin_not_configured") {
        setMessage("Brak FISZY_ADMIN_SECRET w zmiennych środowiskowych Vercela.");
      } else if (data.outcome === "pending_payment") {
        setMessage("Poprzedni zwycięzca ma jeszcze aktywną płatność. Spróbuj ponownie za chwilę.");
      } else {
        setMessage("Nie udało się zapisać nowej aukcji w Redisie.");
      }
    } catch {
      setMessage("Nie udało się połączyć z endpointem administracyjnym.");
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <main className="adminShell">
      <section className="adminCard">
        <p className="eyebrow">Fiszy / panel testowy</p>
        <h1>Uruchamianie aukcji</h1>

        <div className="adminStatus">
          <div>
            <span>Status</span>
            <strong>{auction?.status ?? "—"}</strong>
          </div>
          <div>
            <span>Aktualna cena</span>
            <strong>{auction ? `${auction.currentPrice} zł` : "—"}</strong>
          </div>
          <div>
            <span>Start</span>
            <strong>{formatDateTime(auction?.startsAt)}</strong>
          </div>
        </div>

        <label className="adminLabel" htmlFor="admin-key">
          Sekret administratora
        </label>
        <input
          id="admin-key"
          className="adminInput"
          type="password"
          value={adminKey}
          onChange={(event) => setAdminKey(event.target.value)}
          autoComplete="off"
          placeholder="FISZY_ADMIN_SECRET"
        />

        <button
          className="buyButton"
          type="button"
          onClick={startAuction}
          disabled={!adminKey || isStarting}
        >
          {isStarting ? "URUCHAMIAM..." : "NOWA AUKCJA — START ZA 60 SEKUND"}
        </button>

        {message ? <p className="adminMessage">{message}</p> : null}

        <div className="orderSection">
          <div className="orderHeader">
            <div>
              <p className="eyebrow">Realizacja</p>
              <h2>Zamówienie zwycięzcy</h2>
            </div>
            <button
              className="adminSecondaryButton"
              type="button"
              onClick={loadOrder}
              disabled={!adminKey || isLoadingOrder}
            >
              {isLoadingOrder ? "POBIERAM..." : "POBIERZ ZAMÓWIENIE"}
            </button>
          </div>

          {order ? (
            <div className="orderDetails">
              <div><span>Numer</span><strong>{order.orderId}</strong></div>
              <div><span>Produkt</span><strong>{order.product}</strong></div>
              <div><span>Kwota</span><strong>{order.amount} zł</strong></div>
              <div><span>Opłacono</span><strong>{formatDateTime(order.paidAt)}</strong></div>
              <div><span>Klient</span><strong>{order.customer.name ?? "—"}</strong></div>
              <div><span>E-mail</span><strong>{order.customer.email ?? "—"}</strong></div>
              <div><span>Telefon</span><strong>{order.customer.phone ?? "—"}</strong></div>
              <div className="orderWide"><span>Adres dostawy</span><strong>{formatAddress(order)}</strong></div>
            </div>
          ) : null}

          {orderMessage ? <p className="adminMessage">{orderMessage}</p> : null}
        </div>

        <p className="adminNote">
          Każde uruchomienie tworzy nową sesję. Poprzedni zwycięzca nie blokuje kolejnego testu.
        </p>

        <a className="adminLink" href="/">
          Otwórz stronę aukcji →
        </a>
      </section>
    </main>
  );
}
