import Link from "next/link";
import styles from "./public.module.css";

export function PublicHeader({ profileActive = false }: { profileActive?: boolean }) {
  return (
    <header className={styles.header}>
      <Link className={styles.brand} href="/" aria-label="Fiszy — strona główna">
        Fiszy<span className={styles.brandDot}>.</span>
      </Link>
      <nav className={styles.nav} aria-label="Główna nawigacja">
        <Link className={styles.navLink} href="/#jak-to-dziala">
          Jak to działa
        </Link>
        <Link
          className={`${styles.navLink} ${styles.navLinkPrimary}`}
          href="/moje-fiszy"
          aria-current={profileActive ? "page" : undefined}
        >
          Moje Fiszy
        </Link>
      </nav>
    </header>
  );
}
