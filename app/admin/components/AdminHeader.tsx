import styles from "../AdminDashboard.module.css";

type AdminHeaderProps = {
  environment: string;
  refreshing: boolean;
  lastUpdated: number | null;
  onRefresh: () => void;
  onLogout: () => void;
};

export function AdminHeader({
  environment,
  refreshing,
  lastUpdated,
  onRefresh,
  onLogout,
}: AdminHeaderProps) {
  return (
    <header className={styles.header}>
      <div>
        <div className={styles.brandLine}>
          <span className={styles.brand}>Fiszy.</span>
          <span className={styles.environment}>{environment}</span>
        </div>
        <p className={styles.headerSubtitle}>
          Aukcje, rundy i opłacone zamówienia
          {lastUpdated ? (
            <span> · aktualizacja {new Date(lastUpdated).toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}</span>
          ) : null}
        </p>
      </div>

      <div className={styles.headerActions}>
        <a
          className={styles.secondaryButton}
          href="/"
          target="_blank"
          rel="noreferrer"
          aria-label="Otwórz portal aukcji w nowej karcie"
        >
          Portal <span aria-hidden="true">↗</span>
        </a>
        <button
          className={styles.iconButton}
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          aria-busy={refreshing}
          aria-label="Odśwież dane panelu"
          title="Odśwież dane"
        >
          <span className={refreshing ? styles.rotating : ""} aria-hidden="true">↻</span>
        </button>
        <button className={styles.ghostButton} type="button" onClick={onLogout}>
          Wyloguj
        </button>
      </div>
    </header>
  );
}
