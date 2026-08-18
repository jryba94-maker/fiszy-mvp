"use client";

import { useUser } from "@clerk/nextjs";
import { useCallback, useEffect, useState } from "react";
import { fetchAuctionDetail, type PublicAuction } from "../public/auction-data";
import {
  readBrowserReminderSettings,
  readSeenReminderIds,
  rememberReminderId,
  REMINDER_SETTINGS_EVENT,
  WATCHLIST_CHANGED_EVENT,
} from "./browser-notifications";
import styles from "./pwa.module.css";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in window.navigator && (window.navigator as Navigator & { standalone?: boolean }).standalone === true);
}

function reminderFor(auction: PublicAuction, now: number, leadMinutes: number) {
  const startsAt = Date.parse(auction.startsAt);
  const leadTime = leadMinutes * 60_000;
  if (auction.status === "live") {
    return {
      id: `live:${auction.auctionId}:${auction.runId}`,
      title: "Aukcja właśnie trwa",
      body: `${auction.product} — cena już spada.`,
    };
  }
  if (auction.status === "waiting" && startsAt > now && startsAt - now <= leadTime) {
    return {
      id: `start:${auction.auctionId}:${auction.runId}:${leadMinutes}`,
      title: `Aukcja startuje za mniej niż ${leadMinutes} min`,
      body: auction.product,
    };
  }
  return null;
}

async function showAuctionReminder(auction: PublicAuction, title: string, body: string, tag: string) {
  const registration = await navigator.serviceWorker.ready;
  await registration.showNotification(title, {
    body,
    tag,
    icon: "/icon.svg",
    badge: "/icon.svg",
    data: { url: `/aukcje/${encodeURIComponent(auction.auctionId)}` },
  });
}

export function PwaManager() {
  const { isLoaded, isSignedIn } = useUser();
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
  const [updateReady, setUpdateReady] = useState<ServiceWorker | null>(null);
  const [offline, setOffline] = useState(false);
  const [installDismissed, setInstallDismissed] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let active = true;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).then((registration) => {
      if (!active) return;
      if (registration.waiting) setUpdateReady(registration.waiting);
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) {
            setUpdateReady(worker);
          }
        });
      });
    }).catch(() => undefined);

    const reloadOnControllerChange = () => window.location.reload();
    navigator.serviceWorker.addEventListener("controllerchange", reloadOnControllerChange);
    return () => {
      active = false;
      navigator.serviceWorker.removeEventListener("controllerchange", reloadOnControllerChange);
    };
  }, []);

  useEffect(() => {
    const receivePrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPromptEvent);
    };
    const markInstalled = () => setInstallPrompt(null);
    const updateConnection = () => setOffline(!navigator.onLine);
    updateConnection();
    window.addEventListener("beforeinstallprompt", receivePrompt);
    window.addEventListener("appinstalled", markInstalled);
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
    return () => {
      window.removeEventListener("beforeinstallprompt", receivePrompt);
      window.removeEventListener("appinstalled", markInstalled);
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
    };
  }, []);

  const checkReminders = useCallback(async () => {
    if (!isLoaded || !isSignedIn || !("Notification" in window) || Notification.permission !== "granted") return;
    const settings = readBrowserReminderSettings();
    if (!settings.enabled || !navigator.onLine || !("serviceWorker" in navigator)) return;
    try {
      const response = await fetch("/api/account/watchlist", { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json() as { auctionIds?: string[] };
      const details = await Promise.allSettled((data.auctionIds ?? []).slice(0, 20).map((auctionId) => fetchAuctionDetail(auctionId)));
      const seen = readSeenReminderIds();
      const now = Date.now();
      for (const result of details) {
        if (result.status !== "fulfilled") continue;
        const reminder = reminderFor(result.value, now, settings.leadMinutes);
        if (!reminder || seen.has(reminder.id)) continue;
        await showAuctionReminder(result.value, reminder.title, reminder.body, reminder.id);
        rememberReminderId(reminder.id);
      }
    } catch {
      // Reminders are best-effort and must never interrupt the auction screen.
    }
  }, [isLoaded, isSignedIn]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    void checkReminders();
    const timer = window.setInterval(() => void checkReminders(), 30_000);
    const refresh = () => void checkReminders();
    window.addEventListener(REMINDER_SETTINGS_EVENT, refresh);
    window.addEventListener(WATCHLIST_CHANGED_EVENT, refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(REMINDER_SETTINGS_EVENT, refresh);
      window.removeEventListener(WATCHLIST_CHANGED_EVENT, refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [checkReminders, isLoaded, isSignedIn]);

  const install = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  const activateUpdate = () => updateReady?.postMessage({ type: "SKIP_WAITING" });
  const showInstall = Boolean(installPrompt && !installDismissed && !isStandalone());
  if (!offline && !updateReady && !showInstall) return null;

  return (
    <aside className={styles.toast} aria-live="polite">
      <div>
        <strong>{offline ? "Jesteś offline" : updateReady ? "Nowa wersja Fiszy jest gotowa" : "Zainstaluj Fiszy"}</strong>
        <span>{offline ? "Możesz przeglądać otwartą stronę, ale akcje aukcji wymagają internetu." : updateReady ? "Odśwież aplikację, aby korzystać z najnowszych zmian." : "Otwieraj portal z ekranu telefonu jak zwykłą aplikację."}</span>
      </div>
      {!offline && updateReady ? <button type="button" onClick={activateUpdate}>Aktualizuj</button> : null}
      {!offline && !updateReady && showInstall ? <button type="button" onClick={() => void install()}>Zainstaluj</button> : null}
      {!offline && showInstall ? <button className={styles.dismiss} type="button" aria-label="Zamknij" onClick={() => setInstallDismissed(true)}>×</button> : null}
    </aside>
  );
}
