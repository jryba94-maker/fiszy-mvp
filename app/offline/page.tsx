import Link from "next/link";
import styles from "./page.module.css";

export default function OfflinePage() {
  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <span className={styles.logo}>F<span>.</span></span>
        <p className={styles.eyebrow}>Tryb offline</p>
        <h1>Brak połączenia z internetem</h1>
        <p>Aukcje i płatności wymagają aktualnych danych z serwera. Po odzyskaniu połączenia wróć do katalogu i odśwież cenę.</p>
        <Link href="/">Spróbuj ponownie</Link>
      </section>
    </main>
  );
}
