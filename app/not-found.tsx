import Link from "next/link";
import styles from "./system.module.css";

export default function NotFound() {
  return (
    <main className={styles.shell}>
      <section className={styles.card}>
        <h1>Nie ma takiej aukcji</h1>
        <p>Link mógł wygasnąć albo aukcja została przeniesiona do archiwum.</p>
        <Link className={styles.link} href="/">
          Zobacz aktualne aukcje
        </Link>
      </section>
    </main>
  );
}
