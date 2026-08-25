"use client";

import { useEffect, useState } from "react";
import styles from "../AdminDashboard.module.css";

const CHECKS = [
  ["d7-stock", "7 dni: produkt, dostępność i dane sprzedawcy potwierdzone"],
  ["d7-preview", "7 dni: pełna próba generalna wykonana na chronionym Preview"],
  ["d7-legal", "7 dni: regulamin, prywatność, reklamacje i kontakt sprawdzone"],
  ["h24-config", "24 godziny: parametry oraz termin aukcji sprawdzone przez drugą osobę"],
  ["h24-email", "24 godziny: wiadomości przypominające są w kolejce"],
  ["h1-health", "1 godzina: panel gotowości nie pokazuje blokad"],
  ["h1-backup", "1 godzina: wykonano szyfrowany eksport danych przed startem"],
  ["m10-operator", "10 minut: operator ma otwarty panel i procedurę awaryjną"],
  ["m10-public", "10 minut: strona aukcji działa na telefonie bez sesji administratora"],
  ["after-order", "Po aukcji: płatność, zamówienie i dane dostawy są spójne"],
  ["after-report", "Po aukcji: pobrano raport CSV i zapisano wynik próby"],
] as const;

const STORAGE_KEY = "fiszy.admin.launch-checklist.v1";

export function LaunchChecklist() {
  const [done, setDone] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try { setDone(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<string, boolean>); } catch { setDone({}); }
  }, []);
  const toggle = (id: string) => setDone((current) => {
    const next = { ...current, [id]: !current[id] };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return next;
  });
  const completed = CHECKS.filter(([id]) => done[id]).length;
  return (
    <section className={styles.panelSection} aria-labelledby="launch-checklist-heading">
      <div className={styles.sectionHeader}><div><p className={styles.eyebrow}>Procedura startowa</p><h2 id="launch-checklist-heading">Checklista operatora</h2></div><span className={completed === CHECKS.length ? styles.healthReady : styles.healthDegraded}>{completed}/{CHECKS.length}</span></div>
      <p className={styles.inlineStatus}>Lista jest pomocnicza i zapisywana tylko w tej przeglądarce. Techniczne blokady pozostają w panelu gotowości.</p>
      <div className={styles.checklistGrid}>{CHECKS.map(([id, label]) => <label key={id} className={styles.checklistItem}><input type="checkbox" checked={Boolean(done[id])} onChange={() => toggle(id)} /><span>{label}</span></label>)}</div>
    </section>
  );
}
