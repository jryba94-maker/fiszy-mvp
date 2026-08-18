"use client";

import styles from "./system.module.css";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className={styles.shell}>
      <section className={styles.card} role="alert">
        <h1>Coś poszło nie tak</h1>
        <p>
          Twoja płatność nie została przez ten ekran powtórzona. Odśwież dane
          albo wróć bezpiecznie do katalogu aukcji.
        </p>
        <div className={styles.actions}>
          <button className={styles.button} type="button" onClick={reset}>
            Spróbuj ponownie
          </button>
          <a className={`${styles.link} ${styles.linkSecondary}`} href="/">
            Wróć do katalogu
          </a>
        </div>
      </section>
    </main>
  );
}
