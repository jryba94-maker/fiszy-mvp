"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fetchAuctionDetail } from "../components/public/auction-data";
import {
  DEVICE_HISTORY_EVENT,
  readDeviceHistory,
  refreshRecordedAuction,
  type DeviceAuctionRecord,
} from "../components/public/device-history";
import { PublicHeader } from "../components/public/PublicHeader";
import { SafeAuctionImage } from "../components/public/SafeAuctionImage";
import { StatusBadge } from "../components/public/StatusBadge";
import styles from "./page.module.css";

function entryText(record: DeviceAuctionRecord) {
  if (record.entryState === "active") return "Wejście opłacone";
  if (record.entryState === "checkout") return "Płatność za wejście rozpoczęta";
  if (record.entryState === "cancelled") return "Wejście anulowane";
  if (record.entryState === "unconfirmed") return "Wejście niepotwierdzone";
  return null;
}

function purchaseText(record: DeviceAuctionRecord) {
  if (record.purchaseState === "paid") return "Wygrana opłacona";
  if (record.purchaseState === "checkout") return "Płatność za wygraną rozpoczęta";
  if (record.purchaseState === "lost") return "Ktoś kliknął wcześniej";
  if (record.purchaseState === "cancelled") return "Zakup anulowany";
  return null;
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("pl-PL", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function DeviceProfile() {
  const [records, setRecords] = useState<DeviceAuctionRecord[]>([]);
  const [ready, setReady] = useState(false);
  const [refreshing, setRefreshing] = useState(true);

  useEffect(() => {
    let active = true;
    const syncFromStorage = () => {
      if (active) {
        setRecords(readDeviceHistory());
        setReady(true);
      }
    };

    syncFromStorage();
    window.addEventListener(DEVICE_HISTORY_EVENT, syncFromStorage);
    window.addEventListener("storage", syncFromStorage);

    const refresh = async () => {
      const current = readDeviceHistory();
      const auctionIds = [...new Set(current.map((record) => record.auctionId))];
      await Promise.allSettled(
        auctionIds.map(async (auctionId) => {
          const auction = await fetchAuctionDetail(auctionId);
          refreshRecordedAuction(auction);
        }),
      );
      if (active) {
        setRecords(readDeviceHistory());
        setRefreshing(false);
      }
    };
    void refresh();

    return () => {
      active = false;
      window.removeEventListener(DEVICE_HISTORY_EVENT, syncFromStorage);
      window.removeEventListener("storage", syncFromStorage);
    };
  }, []);

  const stats = {
    entered: records.filter((record) => record.entryState === "active" || record.entryState === "checkout").length,
    won: records.filter((record) => record.purchaseState === "paid").length,
    pending: records.filter((record) => record.purchaseState === "checkout").length,
  };

  return (
    <main className={styles.page}>
      <PublicHeader profileActive />
      <div className={styles.main}>
        <section className={styles.intro} aria-labelledby="profile-title">
          <div>
            <p className={styles.eyebrow}>Twój profil lokalny</p>
            <h1 id="profile-title">Moje Fiszy</h1>
          </div>
          <p className={styles.introText}>
            Tu wrócisz do aukcji, w których rozpocząłeś wejście, kliknąłeś zakup albo wygrałeś.
          </p>
        </section>

        <aside className={styles.deviceNotice}>
          <span className={styles.deviceIcon} aria-hidden="true">i</span>
          <div>
            <strong>Ta historia należy tylko do tej przeglądarki</strong>
            <p>
              Nie pokazujemy danych innych osób. Wyczyszczenie danych przeglądarki usunie tę historię.
              Pełne konto działające między urządzeniami będzie kolejnym etapem portalu.
            </p>
          </div>
        </aside>

        <div className={styles.stats} aria-label="Podsumowanie aktywności">
          <div className={styles.stat}><span className={styles.statValue}>{stats.entered}</span><span className={styles.statLabel}>rozpoczęte wejścia</span></div>
          <div className={styles.stat}><span className={styles.statValue}>{stats.won}</span><span className={styles.statLabel}>opłacone wygrane</span></div>
          <div className={styles.stat}><span className={styles.statValue}>{stats.pending}</span><span className={styles.statLabel}>płatności w toku</span></div>
        </div>

        {!ready ? (
          <section className={styles.empty} role="status" aria-busy="true">
            <div>
              <h2>Ładujemy Twoją historię…</h2>
              <p>Sprawdzamy aukcje zapisane w tej przeglądarce.</p>
            </div>
          </section>
        ) : records.length ? (
          <section aria-labelledby="history-title">
            <div className={styles.sectionTop}>
              <h2 id="history-title">Historia tego urządzenia</h2>
              <span className={styles.syncLabel} aria-live="polite">
                {refreshing ? "Odświeżamy statusy…" : "Statusy odświeżone"}
              </span>
            </div>
            <div className={styles.list}>
              {records.map((record) => {
                const entry = entryText(record);
                const purchase = purchaseText(record);
                const shownPrice = record.reservedPrice ?? record.currentPrice;
                return (
                  <article className={styles.record} key={record.key}>
                    <SafeAuctionImage
                      src={record.productImageUrl}
                      alt={record.product}
                      sizes="(max-width: 560px) 100vw, 210px"
                      frameClassName={styles.recordImage}
                    />
                    <div className={styles.recordBody}>
                      <div className={styles.recordTop}>
                        <div><StatusBadge status={record.status} /><h3>{record.product}</h3></div>
                        <span className={styles.updated}>Aktualizacja {dateLabel(record.updatedAt)}</span>
                      </div>
                      <div className={styles.chips}>
                        {entry ? <span className={styles.chipMuted}>{entry}</span> : null}
                        {purchase ? <span className={record.purchaseState === "paid" ? styles.chipAccent : styles.chip}>{purchase}</span> : null}
                      </div>
                      <div className={styles.recordBottom}>
                        <div><span className={styles.priceLabel}>{record.reservedPrice ? "Zarezerwowana cena" : "Ostatnia cena"}</span><span className={styles.price}>{shownPrice} zł</span></div>
                        <Link className={styles.recordLink} href={record.href}>Zobacz aukcję</Link>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ) : (
          <section className={styles.empty}>
            <div>
              <h2>Jeszcze tu pusto</h2>
              <p>Historia pojawi się po rozpoczęciu wejścia do pierwszej aukcji na tym urządzeniu.</p>
              <Link className={styles.emptyLink} href="/#aukcje">Przejdź do aukcji</Link>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
