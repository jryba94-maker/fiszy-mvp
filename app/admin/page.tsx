"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  createAdminSession,
  createAuction,
  deleteAdminSession,
  getAdminSession,
  loadAuctions,
  loadHealth,
  loadOrders,
  startAuctionRun,
  updateAuction,
} from "./api";
import { AdminGate } from "./components/AdminGate";
import { AdminHeader } from "./components/AdminHeader";
import { AuctionEditor } from "./components/AuctionEditor";
import { AuctionList } from "./components/AuctionList";
import { HealthPanel } from "./components/HealthPanel";
import { KpiGrid } from "./components/KpiGrid";
import { OrdersPanel } from "./components/OrdersPanel";
import styles from "./AdminDashboard.module.css";
import type {
  AdminAuction,
  AdminHealth,
  AdminOrder,
  AuctionDefinitionInput,
  AuctionFilter,
} from "./types";

type SessionStatus = "checking" | "signed_out" | "authenticated" | "unconfigured";

type Notice = {
  tone: "success" | "info" | "error";
  message: string;
} | null;

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Wystąpił nieoczekiwany błąd. Spróbuj ponownie.";
}

function isUnauthorized(error: unknown) {
  return error instanceof ApiError && error.status === 401;
}

export default function AdminPage() {
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>("checking");
  const [sessionError, setSessionError] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [auctions, setAuctions] = useState<AdminAuction[]>([]);
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [health, setHealth] = useState<AdminHealth | null>(null);
  const [filter, setFilter] = useState<AuctionFilter>("all");
  const [editingAuction, setEditingAuction] = useState<AdminAuction | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState("");
  const [savingEditor, setSavingEditor] = useState(false);
  const [busyAuctionId, setBusyAuctionId] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [legacyMode, setLegacyMode] = useState(false);
  const loadingRef = useRef(false);

  useEffect(() => {
    let active = true;

    const checkSession = async () => {
      try {
        const session = await getAdminSession();
        if (!active) return;
        setSessionStatus(
          !session.configured
            ? "unconfigured"
            : session.authenticated
              ? "authenticated"
              : "signed_out",
        );
      } catch (error) {
        if (!active) return;
        setSessionStatus("signed_out");
        setSessionError(errorMessage(error));
      }
    };

    void checkSession();
    return () => {
      active = false;
    };
  }, []);

  const handleExpiredSession = useCallback(() => {
    setSessionStatus("signed_out");
    setSessionError("Sesja administratora wygasła. Zaloguj się ponownie.");
    setAuctions([]);
    setOrders([]);
    setHealth(null);
  }, []);

  const loadDashboard = useCallback(async (silent = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    if (!silent) setDashboardLoading(true);

    try {
      const [auctionResult, orderResult, healthResult] = await Promise.allSettled([
        loadAuctions(),
        loadOrders(),
        loadHealth(),
      ]);
      const failures: string[] = [];
      let anySuccess = false;
      let usedLegacy = false;

      if (auctionResult.status === "fulfilled") {
        setAuctions(auctionResult.value.auctions);
        usedLegacy ||= auctionResult.value.legacy;
        anySuccess = true;
      } else {
        if (isUnauthorized(auctionResult.reason)) {
          handleExpiredSession();
          return;
        }
        failures.push(`Aukcje: ${errorMessage(auctionResult.reason)}`);
      }

      if (orderResult.status === "fulfilled") {
        setOrders(orderResult.value.orders);
        usedLegacy ||= orderResult.value.legacy;
        anySuccess = true;
      } else {
        if (isUnauthorized(orderResult.reason)) {
          handleExpiredSession();
          return;
        }
        failures.push(`Zamówienia: ${errorMessage(orderResult.reason)}`);
      }

      if (healthResult.status === "fulfilled") {
        setHealth(healthResult.value);
        anySuccess = true;
      } else {
        if (isUnauthorized(healthResult.reason)) {
          handleExpiredSession();
          return;
        }
        failures.push(`System: ${errorMessage(healthResult.reason)}`);
      }

      setLegacyMode(usedLegacy);
      setDashboardError(failures.join(" "));
      if (anySuccess) setLastUpdated(Date.now());
    } finally {
      loadingRef.current = false;
      if (!silent) setDashboardLoading(false);
    }
  }, [handleExpiredSession]);

  useEffect(() => {
    if (sessionStatus !== "authenticated") return;
    void loadDashboard();

    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadDashboard(true);
    }, 12_000);

    return () => window.clearInterval(timer);
  }, [sessionStatus, loadDashboard]);

  const handleLogin = async (secret: string) => {
    setLoginBusy(true);
    setSessionError("");

    try {
      const session = await createAdminSession(secret);
      if (!session.configured) {
        setSessionStatus("unconfigured");
        return false;
      }
      if (!session.authenticated) {
        setSessionError("Nieprawidłowy sekret administratora.");
        return false;
      }

      setSessionStatus("authenticated");
      return true;
    } catch (error) {
      setSessionError(
        error instanceof ApiError && error.status === 401
          ? "Nieprawidłowy sekret administratora."
          : errorMessage(error),
      );
      return false;
    } finally {
      setLoginBusy(false);
    }
  };

  const handleLogout = async () => {
    try {
      await deleteAdminSession();
    } catch {
      // Local state is cleared even if the server cannot acknowledge logout.
    } finally {
      setSessionStatus("signed_out");
      setSessionError("");
      setAuctions([]);
      setOrders([]);
      setHealth(null);
      setNotice(null);
      setEditingAuction(null);
    }
  };

  const handleEditorSubmit = async (
    input: AuctionDefinitionInput,
    editingAuctionId: string | null,
  ) => {
    setSavingEditor(true);
    setNotice(null);

    try {
      const result = editingAuctionId
        ? await updateAuction(
            editingAuctionId,
            input,
            editingAuction?.auctionId === editingAuctionId
              ? editingAuction.revision ?? undefined
              : undefined,
          )
        : await createAuction(input);
      setNotice({
        tone: result.legacy ? "info" : "success",
        message: result.legacy
          ? "Aukcja została uruchomiona przez zgodny endpoint MVP. Nowe API nie jest jeszcze dostępne."
          : result.message ?? (editingAuctionId ? "Zmiany aukcji zostały zapisane." : "Nowa aukcja została utworzona."),
      });
      setEditingAuction(null);
      await loadDashboard();
      return true;
    } catch (error) {
      if (isUnauthorized(error)) handleExpiredSession();
      else setNotice({ tone: "error", message: errorMessage(error) });
      return false;
    } finally {
      setSavingEditor(false);
    }
  };

  const handleStartRun = async (auction: AdminAuction) => {
    const confirmed = window.confirm(
      `Uruchomić kolejną rundę aukcji „${auction.productName}”? Serwer wyznaczy najbliższy bezpieczny start.`,
    );
    if (!confirmed) return;

    setBusyAuctionId(auction.auctionId);
    setNotice(null);

    try {
      const result = await startAuctionRun(auction);
      setNotice({
        tone: result.legacy ? "info" : "success",
        message: result.legacy
          ? "Runda została uruchomiona przez zgodny endpoint MVP."
          : result.message ?? "Nowa runda została zaplanowana.",
      });
      await loadDashboard();
    } catch (error) {
      if (isUnauthorized(error)) handleExpiredSession();
      else setNotice({ tone: "error", message: errorMessage(error) });
    } finally {
      setBusyAuctionId(null);
    }
  };

  const handleEdit = (auction: AdminAuction) => {
    setEditingAuction(auction);
    window.requestAnimationFrame(() => {
      const editor = document.getElementById("auction-editor");
      editor?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      document.getElementById("editor-heading")?.focus({ preventScroll: true });
    });
  };

  if (sessionStatus !== "authenticated") {
    return (
      <AdminGate
        checking={sessionStatus === "checking"}
        configured={sessionStatus !== "unconfigured"}
        busy={loginBusy}
        error={sessionError}
        onLogin={handleLogin}
      />
    );
  }

  return (
    <main className={styles.dashboardShell} aria-busy={dashboardLoading}>
      <AdminHeader
        environment={health?.environment ?? "panel"}
        refreshing={dashboardLoading}
        lastUpdated={lastUpdated}
        onRefresh={() => void loadDashboard()}
        onLogout={() => void handleLogout()}
      />

      {dashboardLoading && lastUpdated === null ? (
        <p className={styles.srOnly} role="status">
          Ładuję dane panelu administratora.
        </p>
      ) : null}

      {notice ? (
        <div
          className={`${styles.notice} ${styles[`notice_${notice.tone}`]}`}
          role={notice.tone === "error" ? "alert" : "status"}
        >
          <span>{notice.message}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Zamknij komunikat">×</button>
        </div>
      ) : null}

      {dashboardError ? (
        <div className={styles.errorBanner} role="alert">
          <strong>Nie wszystkie dane udało się odświeżyć.</strong>
          <span>{dashboardError}</span>
          <button type="button" onClick={() => void loadDashboard()}>Spróbuj ponownie</button>
        </div>
      ) : null}

      {legacyMode ? (
        <div className={styles.compatibilityBanner} role="status">
          Tryb zgodności MVP: panel pokazuje dane ze starszych endpointów do czasu pełnego uruchomienia nowego API.
        </div>
      ) : null}

      <KpiGrid auctions={auctions} />

      <AuctionList
        auctions={auctions}
        filter={filter}
        busyAuctionId={busyAuctionId}
        onFilterChange={setFilter}
        onEdit={handleEdit}
        onStart={(auction) => void handleStartRun(auction)}
      />

      <AuctionEditor
        editingAuction={editingAuction}
        busy={savingEditor}
        onCancel={() => setEditingAuction(null)}
        onSubmit={handleEditorSubmit}
      />

      <div className={styles.lowerGrid}>
        <OrdersPanel orders={orders} />
        <HealthPanel health={health} />
      </div>

      <footer className={styles.footer}>
        <span>Fiszy / panel operacyjny</span>
        <span>Brakujące lub niedostępne akcje nie są symulowane.</span>
      </footer>
    </main>
  );
}
