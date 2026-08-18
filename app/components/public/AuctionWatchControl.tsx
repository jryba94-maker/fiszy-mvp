"use client";

import { useUser } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { announceWatchlistChange } from "../pwa/browser-notifications";
import { WatchButton } from "./WatchButton";
import styles from "./public.module.css";

export function AuctionWatchControl({ auctionId }: { auctionId: string }) {
  const { isLoaded, isSignedIn } = useUser();
  const [watched, setWatched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isLoaded || !isSignedIn) {
      setWatched(false);
      return;
    }
    const controller = new AbortController();
    fetch("/api/account/watchlist", { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("watchlist")))
      .then((data: { auctionIds?: string[] }) => setWatched((data.auctionIds ?? []).includes(auctionId)))
      .catch(() => undefined);
    return () => controller.abort();
  }, [auctionId, isLoaded, isSignedIn]);

  const toggle = async (_auctionId: string, nextWatched: boolean) => {
    if (busy) return;
    const previous = watched;
    setBusy(true);
    setError("");
    setWatched(nextWatched);
    try {
      const response = await fetch("/api/account/watchlist", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auctionId, watched: nextWatched }),
      });
      if (!response.ok) throw new Error("watchlist");
      announceWatchlistChange();
    } catch {
      setWatched(previous);
      setError("Nie udało się zapisać obserwowanej aukcji.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.watchControl}>
      <WatchButton auctionId={auctionId} watched={watched} busy={busy} onToggle={toggle} />
      {error ? <span role="alert">{error}</span> : null}
    </div>
  );
}
