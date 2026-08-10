"use client";

import { useEffect, useState } from "react";

type AuctionState = {
  runId: string;
  status: "waiting" | "live" | "ended" | "sold";
  currentPrice: number;
  startsAt: string;
  endsAt: string;
};

type StartResponse = {
  outcome: "scheduled" | "unauthorized" | "admin_not_configured" | "storage_error";
  startsAt?: string;
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

export default function AdminPage() {
  const [auction, setAuction] = useState<AuctionState | null>(null);
  const [adminKey, setAdminKey] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  const [message, setMessage] = useState("");

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
        setMessage("Nieprawidłowy klucz administratora.");
      } else if (data.outcome === "admin_not_configured") {
        setMessage("Brak FISZY_ADMIN_KEY w zmiennych środowiskowych Vercela.");
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
          Klucz administratora
        </label>
        <input
          id="admin-key"
          className="adminInput"
          type="password"
          value={adminKey}
          onChange={(event) => setAdminKey(event.target.value)}
          autoComplete="off"
          placeholder="FISZY_ADMIN_KEY"
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
