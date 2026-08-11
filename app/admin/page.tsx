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

type OrdersResponse = {
  outcome: "ok" | "unauthorized" | "admin_not_configured" | "storage_error";
  orders?: Order[];
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

function formatAddress(order: Order) {
  const address = order.shippingAddress;
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
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoadingOrders, setIsLoadingOrders] = useState(false);
  const [ordersMessage, setOrdersMessage] = useState("");

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

  const loadOrders = async () => {
    if (!adminKey || isLoadingOrders) return;

    setIsLoadingOrders(true);
    setOrdersMessage("");

    try {
      const response = await fetch("/api/admin/orders", {
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${adminKey}`,
        },
      });
      const data = (await response.json()) as OrdersResponse;

      if (data.outcome === "ok") {
        const nextOrders = data.orders ?? [];
        setOrders(nextOrders);
        setOrdersMessage(
          nextOrders.length
            ? `Pobrano ${nextOrders.length} zamówień.`
            : "Brak opłaconych zamówień w historii.",
        );
      } else if (data.outcome === "unauthorized") {
        setOrders([]);
        setOrdersMessage("Nieprawidłowy sekret administratora.");
      } else {
        setOrders([]);
        setOrdersMessage("Nie udało się pobrać historii zamówień.");
      }
    } catch {
      setOrders([]);
      setOrdersMessage("Nie udało się połączyć z endpointem historii zamówień.");
    } finally {
      setIsLoadingOrders(false);
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
              <h2>Historia zamówień</h2>
            </div>
            <button
              className="adminSecondaryButton"
              type="button"
              onClick={loadOrders}
              disabled={!adminKey || isLoadingOrders}
            >
              {isLoadingOrders ? "POBIERAM..." : "POBIERZ HISTORIĘ"}
            </button>
          </div>

          {orders.length ? (
            <div className="orderList">
              {orders.map((order) => (
                <article className="orderCard" key={order.orderId}>
                  <div className="orderCardHeader">
                    <strong>{order.orderId}</strong>
                    <span>{formatDateTime(order.paidAt)}</span>
                  </div>
                  <div className="orderDetails">
                    <div><span>Produkt</span><strong>{order.product}</strong></div>
                    <div><span>Kwota</span><strong>{order.amount} zł</strong></div>
                    <div><span>Klient</span><strong>{order.customer.name ?? "—"}</strong></div>
                    <div><span>E-mail</span><strong>{order.customer.email ?? "—"}</strong></div>
                    <div><span>Telefon</span><strong>{order.customer.phone ?? "—"}</strong></div>
                    <div><span>Run ID</span><strong>{order.runId.slice(0, 12)}</strong></div>
                    <div className="orderWide"><span>Adres dostawy</span><strong>{formatAddress(order)}</strong></div>
                  </div>
                </article>
              ))}
            </div>
          ) : null}

          {ordersMessage ? <p className="adminMessage">{ordersMessage}</p> : null}
        </div>

        <p className="adminNote">
          Każde uruchomienie tworzy nową sesję. Historia opłaconych zamówień pozostaje dostępna niezależnie od kolejnych aukcji.
        </p>

        <a className="adminLink" href="/">
          Otwórz stronę aukcji →
        </a>
      </section>
    </main>
  );
}
