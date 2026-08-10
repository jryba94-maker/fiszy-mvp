"use client";

import { useEffect, useState } from "react";

type AuctionState = {
  runId: string;
  status: "waiting" | "live" | "ended" | "payment_pending" | "sold";
  product: string;
  productImageUrl: string | null;
  regularPrice: number;
  startPrice: number;
  floorPrice: number;
  durationMinutes: number;
  currentPrice: number;
  startsAt: string;
  endsAt: string;
};

type AuctionDraft = {
  productName: string;
  productImageUrl: string;
  regularPrice: string;
  startPrice: string;
  floorPrice: string;
  durationMinutes: string;
};

type StartResponse = {
  outcome:
    | "scheduled"
    | "unauthorized"
    | "admin_not_configured"
    | "invalid_request"
    | "auction_in_progress"
    | "auction_changed"
    | "pending_payment"
    | "storage_error";
  startsAt?: string;
};

const DEFAULT_DRAFT: AuctionDraft = {
  productName: "AirPods Pro",
  productImageUrl: "",
  regularPrice: "999",
  startPrice: "749",
  floorPrice: "699",
  durationMinutes: "10",
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
  const [draft, setDraft] = useState<AuctionDraft>(DEFAULT_DRAFT);
  const [draftRunId, setDraftRunId] = useState<string | null>(null);
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

  useEffect(() => {
    if (!auction || draftRunId === auction.runId) return;

    setDraft({
      productName: auction.product,
      productImageUrl: auction.productImageUrl ?? "",
      regularPrice: String(auction.regularPrice),
      startPrice: String(auction.startPrice),
      floorPrice: String(auction.floorPrice),
      durationMinutes: String(auction.durationMinutes),
    });
    setDraftRunId(auction.runId);
  }, [auction, draftRunId]);

  const updateDraft = (field: keyof AuctionDraft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

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
            : "Nie ma jeszcze żadnego opłaconego zamówienia.",
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

    const regularPrice = Number(draft.regularPrice);
    const startPrice = Number(draft.startPrice);
    const floorPrice = Number(draft.floorPrice);
    const durationMinutes = Number(draft.durationMinutes);

    if (
      draft.productName.trim().length < 2 ||
      !Number.isInteger(regularPrice) ||
      !Number.isInteger(startPrice) ||
      !Number.isInteger(floorPrice) ||
      !Number.isInteger(durationMinutes) ||
      regularPrice < startPrice ||
      startPrice <= floorPrice ||
      floorPrice < 2 ||
      durationMinutes < 1 ||
      durationMinutes > 120
    ) {
      setMessage(
        "Sprawdź dane: cena regularna ≥ startowa > minimalna (minimum 2 zł), a czas musi wynosić 1–120 minut.",
      );
      return;
    }

    setIsStarting(true);
    setMessage("");

    try {
      const response = await fetch("/api/admin/auction/start", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${adminKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          productName: draft.productName.trim(),
          productImageUrl: draft.productImageUrl.trim() || null,
          regularPrice,
          startPrice,
          floorPrice,
          durationMinutes,
        }),
      });
      const data = (await response.json()) as StartResponse;

      if (data.outcome === "scheduled") {
        setMessage(`Nowa aukcja zaplanowana na ${formatDateTime(data.startsAt)}.`);
        await loadAuction();
      } else if (data.outcome === "unauthorized") {
        setMessage("Nieprawidłowy sekret administratora.");
      } else if (data.outcome === "admin_not_configured") {
        setMessage("Brak FISZY_ADMIN_SECRET w zmiennych środowiskowych Vercela.");
      } else if (data.outcome === "invalid_request") {
        setMessage("Dane aukcji są nieprawidłowe. Sprawdź ceny, czas i adres zdjęcia HTTPS.");
      } else if (data.outcome === "auction_in_progress") {
        setMessage("Trwającej lub oczekującej aukcji nie można zastąpić nowym produktem.");
      } else if (data.outcome === "auction_changed") {
        setMessage("Aukcja została właśnie zmieniona w innym oknie. Formularz odświeży się automatycznie.");
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
          <div>
            <span>Produkt</span>
            <strong>{auction?.product ?? "—"}</strong>
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

        <div className="adminAuctionForm">
          <div className="adminFormHeader">
            <p className="eyebrow">Nowa aukcja</p>
            <h2>Produkt i mechanika ceny</h2>
          </div>

          <div className="adminFormGrid">
            <label className="adminField adminFieldWide">
              <span>Nazwa produktu</span>
              <input
                className="adminInput"
                type="text"
                value={draft.productName}
                onChange={(event) => updateDraft("productName", event.target.value)}
                maxLength={80}
                placeholder="np. Konsola PlayStation 5"
              />
            </label>

            <label className="adminField adminFieldWide">
              <span>Adres zdjęcia (opcjonalnie)</span>
              <input
                className="adminInput"
                type="text"
                value={draft.productImageUrl}
                onChange={(event) =>
                  updateDraft("productImageUrl", event.target.value)
                }
                maxLength={500}
                placeholder="https://.../produkt.jpg"
              />
              <small>Użyj bezpiecznego adresu HTTPS. Bez zdjęcia pokażemy nazwę produktu.</small>
            </label>

            <label className="adminField">
              <span>Cena regularna (zł)</span>
              <input
                className="adminInput"
                type="number"
                min="2"
                max="100000"
                step="1"
                value={draft.regularPrice}
                onChange={(event) => updateDraft("regularPrice", event.target.value)}
              />
            </label>

            <label className="adminField">
              <span>Cena startowa (zł)</span>
              <input
                className="adminInput"
                type="number"
                min="2"
                max="100000"
                step="1"
                value={draft.startPrice}
                onChange={(event) => updateDraft("startPrice", event.target.value)}
              />
            </label>

            <label className="adminField">
              <span>Cena minimalna (zł)</span>
              <input
                className="adminInput"
                type="number"
                min="2"
                max="99999"
                step="1"
                value={draft.floorPrice}
                onChange={(event) => updateDraft("floorPrice", event.target.value)}
              />
            </label>

            <label className="adminField">
              <span>Czas trwania (minuty)</span>
              <input
                className="adminInput"
                type="number"
                min="1"
                max="120"
                step="1"
                value={draft.durationMinutes}
                onChange={(event) =>
                  updateDraft("durationMinutes", event.target.value)
                }
              />
            </label>
          </div>
        </div>

        <button
          className="buyButton"
          type="button"
          onClick={startAuction}
          disabled={!adminKey || isStarting}
        >
          {isStarting
            ? "ZAPISUJĘ..."
            : "ZAPISZ AUKCJĘ — START ZA 60 SEKUND"}
        </button>

        {message ? <p className="adminMessage">{message}</p> : null}

        <div className="orderSection">
          <div className="orderHeader">
            <div>
              <p className="eyebrow">Realizacja</p>
              <h2>Ostatnie opłacone zamówienie</h2>
            </div>
            <button
              className="adminSecondaryButton"
              type="button"
              onClick={loadOrder}
              disabled={!adminKey || isLoadingOrder}
            >
              {isLoadingOrder ? "POBIERAM..." : "POBIERZ OSTATNIE ZAMÓWIENIE"}
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
