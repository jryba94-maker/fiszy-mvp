import styles from "./system.module.css";

export default function Loading() {
  return (
    <main className={styles.shell} aria-live="polite" aria-busy="true">
      <section className={styles.card}>
        <div className={styles.loadingDot} aria-hidden="true" />
        <p>Ładuję aukcje Fiszy…</p>
      </section>
    </main>
  );
}
