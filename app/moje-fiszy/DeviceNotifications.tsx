"use client";

import { useEffect, useState } from "react";
import {
  readBrowserReminderSettings,
  saveBrowserReminderSettings,
  type BrowserReminderSettings,
} from "../components/pwa/browser-notifications";
import styles from "./page.module.css";

type PermissionState = NotificationPermission | "unsupported";

function currentPermission(): PermissionState {
  return typeof window !== "undefined" && "Notification" in window
    ? Notification.permission
    : "unsupported";
}

export function DeviceNotifications() {
  const [settings, setSettings] = useState<BrowserReminderSettings>({ enabled: false, leadMinutes: 10 });
  const [permission, setPermission] = useState<PermissionState>("default");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setSettings(readBrowserReminderSettings());
    setPermission(currentPermission());
  }, []);

  const enable = async () => {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      setPermission("unsupported");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const nextPermission = await Notification.requestPermission();
      setPermission(nextPermission);
      const next = { ...settings, enabled: nextPermission === "granted" };
      setSettings(next);
      saveBrowserReminderSettings(next);
      setMessage(nextPermission === "granted"
        ? "Przypomnienia na tym urządzeniu są włączone."
        : "Przeglądarka nie zezwoliła na powiadomienia.");
    } finally {
      setBusy(false);
    }
  };

  const disable = () => {
    const next = { ...settings, enabled: false };
    setSettings(next);
    saveBrowserReminderSettings(next);
    setMessage("Przypomnienia na tym urządzeniu są wyłączone.");
  };

  const changeLead = (leadMinutes: BrowserReminderSettings["leadMinutes"]) => {
    const next = { ...settings, leadMinutes };
    setSettings(next);
    saveBrowserReminderSettings(next);
  };

  const sendTest = async () => {
    if (permission !== "granted" || !("serviceWorker" in navigator)) return;
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification("Fiszy działa na tym telefonie", {
        body: "Tak zobaczysz przypomnienie przed startem obserwowanej aukcji.",
        tag: "fiszy-reminder-test",
        icon: "/icon.svg",
        data: { url: "/moje-fiszy" },
      });
      setMessage("Wysłaliśmy testowe powiadomienie.");
    } catch {
      setMessage("Telefon nie pozwolił wyświetlić testowego powiadomienia.");
    } finally {
      setBusy(false);
    }
  };

  if (permission === "unsupported") {
    return <div className={styles.deviceNotifications}><strong>Powiadomienia urządzenia</strong><p>Ta przeglądarka nie udostępnia powiadomień aplikacji. Powiadomienia w „Moje Fiszy” nadal działają.</p></div>;
  }

  return (
    <div className={styles.deviceNotifications}>
      <div>
        <strong>Przypomnienia na tym urządzeniu</strong>
        <p>Działają, gdy aplikacja Fiszy jest uruchomiona lub pozostaje aktywna w tle. Pełne powiadomienia push dodamy po konfiguracji usługi wysyłkowej.</p>
      </div>
      <label>
        <span>Przypomnij przed startem</span>
        <select
          value={settings.leadMinutes}
          disabled={!settings.enabled}
          onChange={(event) => changeLead(Number(event.target.value) as BrowserReminderSettings["leadMinutes"])}
        >
          <option value={5}>5 minut</option>
          <option value={10}>10 minut</option>
          <option value={15}>15 minut</option>
          <option value={30}>30 minut</option>
        </select>
      </label>
      <div className={styles.deviceNotificationActions}>
        {settings.enabled && permission === "granted"
          ? <button type="button" disabled={busy} onClick={disable}>Wyłącz</button>
          : <button type="button" disabled={busy || permission === "denied"} onClick={() => void enable()}>{busy ? "Włączam…" : "Włącz na tym urządzeniu"}</button>}
        {settings.enabled && permission === "granted" ? <button type="button" disabled={busy} onClick={() => void sendTest()}>Wyślij test</button> : null}
      </div>
      {permission === "denied" ? <p className={styles.deviceWarning}>Powiadomienia są zablokowane w ustawieniach przeglądarki lub telefonu.</p> : null}
      {message ? <p className={styles.deviceMessage} role="status">{message}</p> : null}
    </div>
  );
}
