import styles from "./page.module.css";

export default function AuctionLoading() {
  return (
    <main className={styles.page}>
      <div className={styles.loadingShell} aria-label="Ładowanie aukcji" aria-busy="true">
        <span className={styles.srOnly}>Ładowanie aukcji…</span>
        <div className={styles.loadingBlock} />
        <div className={styles.loadingBlock} />
      </div>
    </main>
  );
}
