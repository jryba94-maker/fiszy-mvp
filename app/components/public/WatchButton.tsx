"use client";

import { SignInButton, useUser } from "@clerk/nextjs";
import styles from "./public.module.css";

export function WatchButton({ auctionId, watched, busy, onToggle }: {
  auctionId: string;
  watched: boolean;
  busy: boolean;
  onToggle: (auctionId: string, watched: boolean) => void;
}) {
  const { isLoaded, isSignedIn } = useUser();
  if (!isLoaded) return <span className={styles.watchPlaceholder} aria-hidden="true" />;
  if (!isSignedIn) {
    return <SignInButton mode="modal"><button className={styles.watchButton} type="button" aria-label="Zaloguj się, aby obserwować aukcję"><span aria-hidden="true">☆</span> Obserwuj</button></SignInButton>;
  }
  return (
    <button className={`${styles.watchButton} ${watched ? styles.watchButtonActive : ""}`} type="button" disabled={busy} aria-pressed={watched} onClick={() => onToggle(auctionId, !watched)}>
      <span aria-hidden="true">{watched ? "★" : "☆"}</span> {watched ? "Obserwujesz" : "Obserwuj"}
    </button>
  );
}
