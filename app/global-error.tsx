"use client";

import styles from "./system.module.css";

export default function GlobalError({ reset }: { reset: () => void }) {
  return (
    <html lang="pl">
      <body className={styles.globalBody}>
        <main className={styles.shell}>
          <section className={styles.card} role="alert">
            <h1>Fiszy chwilowo nie odpowiada</h1>
            <p>Spróbuj ponownie. Żadna płatność nie zostanie automatycznie powtórzona.</p>
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
      </body>
    </html>
  );
}
