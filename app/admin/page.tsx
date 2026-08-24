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
  setAuctionRecordState,
  startAuctionRun,
  updateAuction,
  updateOrderFulfillment,
} from "./api";
import { AdminGate } from "./components/AdminGate";
import { AdminHeader } from "./components/AdminHeader";
import { AuditPanel } from "./components/AuditPanel";
import { AuctionEditor } from "./components/AuctionEditor";
import { AuctionList } from "./components/AuctionList";
import { HealthPanel } from "./components/HealthPanel";
import { KpiGrid } from "./components/KpiGrid";
import { OrdersPanel } from "./components/OrdersPanel";
import { PortalOperationsPanel } from "./components/PortalOperationsPanel";
import { RunHistoryPanel } from "./components/RunHistoryPanel";
import styles from "./AdminDashboard.module.css";
import type {
  AdminAuction,
  AdminHealth,
  AdminOrder,
  AuctionDefinitionInput,
  AuctionFilter,
  FulfillmentUpdateInput,
} from "./types";

type SessionStatus = "checking" | "signed_out" | "authenticated" | "unconfigured";
type AdminSection = "overview" | "auctions" | "orders" | "history" | "users" | "audit";

const ADMIN_SECTIONS: Array<{ id: AdminSection; label: string; caption: string }> = [
  { id: "overview", label: "Pulpit", caption: "Wyniki i system" },
  { id: "auctions", label: "Aukcje", caption: "Lista i edycja" },
  { id: "orders", label: "Zamówienia", caption: "Realizacja" },
  { id: "history", label: "Rundy", caption: "Uczestnicy" },
  { id: "users", label: "Użytkownicy", caption: "Pomoc i lista e-mail" },
  { id: "audit", label: "Dziennik", caption: "Zmiany i zdarzenia" },
];

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
  const [adminRole, setAdminRole] = useState("owner");
  const [sessionError, setSessionError] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [auctions, setAuctions] = useState<AdminAuction[]>([]);
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [health, setHealth] = useState<AdminHealth | null>(null);
  const [filter, setFilter] = useState<AuctionFilter>("all");
  const [auctionSearch, setAuctionSearch] = useState("");
  const [editingAuction, setEditingAuction] = useState<AdminAuction | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState("");
  const [savingEditor, setSavingEditor] = useState(false);
  const [busyAuctionId, setBusyAuctionId] = useState<string | null>(null);
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [orderUpdateError, setOrderUpdateError] = useState<{
    orderId: string;
    message: string;
  } | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [legacyMode, setLegacyMode] = useState(false);
  const [activeSection, setActiveSection] = useState<AdminSection>("overview");
  const loadingRef = useRef(false);
  const busyOrderRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;

    const checkSession = async () => {
      try {
        const session = await getAdminSession();
        if (!active) return;
        setAdminRole(session.role);
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
    setBusyAuctionId(null);
    setBusyOrderId(null);
    busyOrderRef.current = null;
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
    }, 30_000);

    return () => window.clearInterval(timer);
  }, [sessionStatus, loadDashboard]);

  const handleLogin = async (secret: string) => {
    setLoginBusy(true);
    setSessionError("");

    try {
      const session = await createAdminSession(secret);
      setAdminRole(session.role);
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
      setAuctionSearch("");
      setFilter("all");
      setOrderUpdateError(null);
      busyOrderRef.current = null;
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
          ? "Aukcja została uruchomiona przez zgodny endpoint MVP."
          : result.message ?? (editingAuctionId
              ? "Zmiany aukcji zostały zapisane."
              : "Nowa aukcja została utworzona."),
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

  const handleStartRun = async (auction: AdminAuction, startsAt: string) => {
    if (auction.recordState === "archived") return;

    setBusyAuctionId(auction.auctionId);
    setNotice(null);

    try {
      const result = await startAuctionRun(auction, startsAt);
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

  const handleArchiveToggle = async (auction: AdminAuction) => {
    const restoring = auction.recordState === "archived";
    const confirmed = window.confirm(
      restoring
        ? `Przywrócić aukcję „${auction.productName}”?`
        : `Przenieść aukcję „${auction.productName}” do archiwum?`,
    );
    if (!confirmed) return;

    setBusyAuctionId(auction.auctionId);
    setNotice(null);
    try {
      const nextState = restoring
        ? auction.runId ? "published" as const : "draft" as const
        : "archived" as const;
      const result = await setAuctionRecordState(
        auction.auctionId,
        nextState,
        auction.revision ?? undefined,
      );
      setNotice({
        tone: "success",
        message: result.message ?? (restoring
          ? "Aukcja została przywrócona."
          : "Aukcja została przeniesiona do archiwum."),
      });
      if (!restoring && editingAuction?.auctionId === auction.auctionId) {
        setEditingAuction(null);
      }
      await loadDashboard();
    } catch (error) {
      if (isUnauthorized(error)) handleExpiredSession();
      else setNotice({ tone: "error", message: errorMessage(error) });
    } finally {
      setBusyAuctionId(null);
    }
  };

  const handleFulfillmentUpdate = async (
    order: AdminOrder,
    input: FulfillmentUpdateInput,
  ) => {
    if (busyOrderRef.current) return false;
    const previousFulfillment = order.fulfillment;
    const optimisticFulfillment = {
      status: input.status,
      revision: input.expectedRevision,
      carrier: input.carrier,
      trackingNumber: input.trackingNumber,
      note: input.note,
      updatedAt: new Date().toISOString(),
    };

    busyOrderRef.current = order.orderId;
    setBusyOrderId(order.orderId);
    setOrderUpdateError(null);
    setOrders((current) => current.map((item) =>
      item.orderId === order.orderId
        ? { ...item, fulfillment: optimisticFulfillment }
        : item,
    ));

    try {
      const fulfillment = await updateOrderFulfillment(order.orderId, input);
      setOrders((current) => current.map((item) =>
        item.orderId === order.orderId ? { ...item, fulfillment } : item,
      ));
      return true;
    } catch (error) {
      setOrders((current) => current.map((item) =>
        item.orderId === order.orderId
          ? { ...item, fulfillment: previousFulfillment }
          : item,
      ));
      if (isUnauthorized(error)) {
        handleExpiredSession();
      } else {
        setOrderUpdateError({
          orderId: order.orderId,
          message: errorMessage(error),
        });
      }
      return false;
    } finally {
      busyOrderRef.current = null;
      setBusyOrderId(null);
    }
  };

  const handleEdit = (auction: AdminAuction) => {
    setActiveSection("auctions");
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
      <div className={styles.adminLayout}>
        <aside className={styles.sidebar} aria-label="Sekcje panelu administratora">
          <div className={styles.sidebarBrand}>Fiszy<span>.</span></div>
          <nav className={styles.sidebarNav}>
            {ADMIN_SECTIONS.map((section) => (
              <button
                key={section.id}
                type="button"
                className={styles.sidebarLink}
                aria-current={activeSection === section.id ? "page" : undefined}
                onClick={() => setActiveSection(section.id)}
              >
                <span>{section.label}</span>
                <small>{section.caption}</small>
              </button>
            ))}
          </nav>
          <a className={styles.sidebarPublicLink} href="/aukcje">Otwórz portal ↗</a>
        </aside>

        <div className={styles.dashboardContent}>
      <AdminHeader
        environment={health?.environment ?? "panel"}
        role={adminRole}
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
          Tryb zgodności MVP: część danych pochodzi ze starszych endpointów.
        </div>
      ) : null}

      {activeSection === "overview" ? (
        <div className={styles.sectionStack}>
          <KpiGrid auctions={auctions} orders={orders} />
          <HealthPanel health={health} />
        </div>
      ) : null}

      {activeSection === "auctions" ? <div className={styles.sectionStack}><AuctionList
        auctions={auctions}
        filter={filter}
        searchQuery={auctionSearch}
        busyAuctionId={busyAuctionId}
        onFilterChange={setFilter}
        onSearchChange={setAuctionSearch}
        onEdit={handleEdit}
        onStart={(auction, startsAt) => void handleStartRun(auction, startsAt)}
        onArchiveToggle={(auction) => void handleArchiveToggle(auction)}
      />

      <AuctionEditor
        editingAuction={editingAuction}
        busy={savingEditor}
        onCancel={() => setEditingAuction(null)}
        onSubmit={handleEditorSubmit}
      /></div> : null}

      {activeSection === "orders" ? (
        <div className={styles.sectionStack}><OrdersPanel
          orders={orders}
          busyOrderId={busyOrderId}
          updateError={orderUpdateError}
          onUpdateFulfillment={handleFulfillmentUpdate}
        /></div>
      ) : null}

      {activeSection === "history" ? <div className={styles.sectionStack}><RunHistoryPanel
        auctions={auctions}
        onSessionExpired={handleExpiredSession}
      /></div> : null}

      {activeSection === "audit" ? <div className={styles.sectionStack}><AuditPanel onSessionExpired={handleExpiredSession} /></div> : null}

      {activeSection === "users" ? <div className={styles.sectionStack}><PortalOperationsPanel onSessionExpired={handleExpiredSession} /></div> : null}

      <footer className={styles.footer}>
        <span>Fiszy / panel operacyjny</span>
        <span>Dane list są stronicowane, a historia szczegółowa ładowana na żądanie.</span>
      </footer>
        </div>
      </div>
    </main>
  );
}
