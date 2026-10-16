"use client";

import { useEffect, useState } from "react";
import styles from "./pwa.module.css";

export function PwaManager() {
  const [updateReady, setUpdateReady] = useState<ServiceWorker | null>(null);
  const [offline, setOffline] = useState(false);

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
    const suppressInstallPrompt = (event: Event) => event.preventDefault();
    const updateConnection = () => setOffline(!navigator.onLine);
    updateConnection();
    window.addEventListener("beforeinstallprompt", suppressInstallPrompt);
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
    return () => {
      window.removeEventListener("beforeinstallprompt", suppressInstallPrompt);
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
    };
  }, []);

  const activateUpdate = () => updateReady?.postMessage({ type: "SKIP_WAITING" });
  if (!offline && !updateReady) return null;

  return (
    <aside className={styles.toast} aria-live="polite">
      <div>
        <strong>{offline ? "Jesteś offline" : "Nowa wersja Fiszy jest gotowa"}</strong>
        <span>{offline ? "Możesz przeglądać otwartą stronę, ale akcje aukcji wymagają internetu." : "Odśwież aplikację, aby korzystać z najnowszych zmian."}</span>
      </div>
      {!offline && updateReady ? <button type="button" onClick={activateUpdate}>Aktualizuj</button> : null}
    </aside>
  );
}
