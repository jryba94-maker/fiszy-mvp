"use client";

import { useState, type FormEvent } from "react";
import styles from "../AdminDashboard.module.css";

type AdminGateProps = {
  checking: boolean;
  configured: boolean;
  busy: boolean;
  error: string;
  onLogin: (secret: string) => Promise<boolean>;
};

export function AdminGate({
  checking,
  configured,
  busy,
  error,
  onLogin,
}: AdminGateProps) {
  const [secret, setSecret] = useState("");

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!secret || busy) return;
    const authenticated = await onLogin(secret);
    if (authenticated) setSecret("");
  };

  return (
    <main className={styles.gateShell}>
      <section className={styles.gateCard} aria-labelledby="admin-gate-title">
        <div className={styles.gateBrand} aria-label="Fiszy">
          Fiszy<span>.</span>
        </div>
        <p className={styles.eyebrow}>Panel administratora</p>
        <h1 id="admin-gate-title" className={styles.gateTitle}>
          Zarządzaj aukcjami z jednego miejsca.
        </h1>

        {checking ? (
          <div className={styles.sessionCheck} role="status">
            <span className={styles.spinner} aria-hidden="true" />
            Sprawdzam bezpieczną sesję…
          </div>
        ) : configured ? (
          <form className={styles.gateForm} onSubmit={handleSubmit}>
            <label className={styles.field} htmlFor="admin-secret">
              <span>Sekret administratora</span>
              <input
                id="admin-secret"
                className={styles.input}
                type="password"
                value={secret}
                onChange={(event) => setSecret(event.target.value)}
                autoComplete="current-password"
                placeholder="Wpisz sekret"
                aria-describedby="admin-secret-hint"
                disabled={busy}
                required
                autoFocus
              />
            </label>
            <p id="admin-secret-hint" className={styles.fieldHint}>
              Sekret tworzy sesję HttpOnly i nie zostaje zapisany w przeglądarce.
            </p>
            <button className={styles.primaryButton} type="submit" disabled={!secret || busy}>
              {busy ? "ODLOKOWUJĘ…" : "ODLOKUJ PANEL"}
            </button>
          </form>
        ) : (
          <div className={styles.blockingNotice} role="alert">
            <strong>Panel nie jest skonfigurowany</strong>
            <span>Dodaj FISZY_ADMIN_SECRET w ustawieniach środowiska.</span>
          </div>
        )}

        {error ? <p className={styles.errorNotice} role="alert">{error}</p> : null}

        <a className={styles.portalLink} href="/">
          Wróć do portalu aukcji <span aria-hidden="true">↗</span>
        </a>
      </section>
    </main>
  );
}
