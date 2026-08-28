"use client";

import { useMemo, useRef, useState } from "react";
import {
  ApiError,
  loadAuctionRunsPage,
  loadRunParticipantsPage,
} from "../api";
import type {
  AdminAuction,
  AdminAuctionRun,
  AdminParticipant,
} from "../types";
import { STATUS_LABELS, formatDateTime, formatMoney } from "../utils";
import styles from "../AdminDashboard.module.css";

type ParticipantsState = {
  items: AdminParticipant[];
  nextCursor: string | null;
  open: boolean;
  loading: boolean;
  error: string;
};

type RunHistoryPanelProps = {
  auctions: AdminAuction[];
  onSessionExpired: () => void;
};

function mergeParticipants(
  current: AdminParticipant[],
  incoming: AdminParticipant[],
) {
  const byId = new Map(current.map((participant) => [participant.participantId, participant]));
  incoming.forEach((participant) => byId.set(participant.participantId, participant));
  return [...byId.values()];
}

function csvCell(value: string | number | null) {
  const text = value === null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export function RunHistoryPanel({
  auctions,
  onSessionExpired,
}: RunHistoryPanelProps) {
  const [selectedAuctionId, setSelectedAuctionId] = useState("");
  const [auctionSearch, setAuctionSearch] = useState("");
  const [dateFilter, setDateFilter] = useState<"all" | "upcoming" | "past" | "undated">("all");
  const [runs, setRuns] = useState<AdminAuctionRun[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [participants, setParticipants] = useState<Record<string, ParticipantsState>>({});
  const selectedAuctionRef = useRef("");
  const runsRequestRef = useRef(0);
  const visibleAuctions = useMemo(() => {
    const query = auctionSearch.trim().toLocaleLowerCase("pl-PL");
    const now = Date.now();
    return [...auctions]
      .filter((auction) => {
        const startsAt = auction.startsAt ? Date.parse(auction.startsAt) : null;
        const matchesDate = dateFilter === "all"
          || (dateFilter === "undated" && startsAt === null)
          || (dateFilter === "upcoming" && startsAt !== null && startsAt >= now)
          || (dateFilter === "past" && startsAt !== null && startsAt < now);
        const haystack = `${auction.productName} ${auction.slug} ${auction.auctionId}`.toLocaleLowerCase("pl-PL");
        return matchesDate && (!query || haystack.includes(query));
      })
      .sort((left, right) => {
        const leftTime = left.startsAt ? Date.parse(left.startsAt) : 0;
        const rightTime = right.startsAt ? Date.parse(right.startsAt) : 0;
        return rightTime - leftTime;
      });
  }, [auctionSearch, auctions, dateFilter]);

  const handleError = (caught: unknown, fallback: string) => {
    if (caught instanceof ApiError && caught.status === 401) {
      onSessionExpired();
      return "Sesja administratora wygasła.";
    }
    return caught instanceof Error ? caught.message : fallback;
  };

  const fetchRuns = async (
    auctionId: string,
    cursor: string | null,
    replace: boolean,
  ) => {
    if (!auctionId || (!replace && loading)) return;
    const requestId = replace ? runsRequestRef.current + 1 : runsRequestRef.current;
    if (replace) runsRequestRef.current = requestId;
    setLoading(true);
    setError("");
    try {
      const page = await loadAuctionRunsPage(auctionId, cursor);
      if (requestId !== runsRequestRef.current || selectedAuctionRef.current !== auctionId) {
        return;
      }
      setRuns((current) => replace ? page.items : [...current, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (caught) {
      if (requestId !== runsRequestRef.current || selectedAuctionRef.current !== auctionId) {
        return;
      }
      setError(handleError(caught, "Nie udało się pobrać historii rund."));
    } finally {
      if (requestId === runsRequestRef.current && selectedAuctionRef.current === auctionId) {
        setLoading(false);
      }
    }
  };

  const selectAuction = (auctionId: string) => {
    selectedAuctionRef.current = auctionId;
    setSelectedAuctionId(auctionId);
    setRuns([]);
    setNextCursor(null);
    setParticipants({});
    setError("");
    if (auctionId) {
      void fetchRuns(auctionId, null, true);
    } else {
      runsRequestRef.current += 1;
      setLoading(false);
    }
  };

  const fetchParticipants = async (
    run: AdminAuctionRun,
    cursor: string | null,
    replace: boolean,
  ) => {
    const current = participants[run.runId];
    if (current?.loading) return;
    setParticipants((state) => ({
      ...state,
      [run.runId]: {
        items: replace ? [] : state[run.runId]?.items ?? [],
        nextCursor: state[run.runId]?.nextCursor ?? null,
        open: true,
        loading: true,
        error: "",
      },
    }));

    try {
      const page = await loadRunParticipantsPage(run.auctionId, run.runId, cursor);
      if (selectedAuctionRef.current !== run.auctionId) return;
      setParticipants((state) => ({
        ...state,
        [run.runId]: {
          items: replace
            ? page.items
            : mergeParticipants(state[run.runId]?.items ?? [], page.items),
          nextCursor: page.nextCursor,
          open: true,
          loading: false,
          error: "",
        },
      }));
    } catch (caught) {
      if (selectedAuctionRef.current !== run.auctionId) return;
      const detail = handleError(caught, "Nie udało się pobrać uczestników.");
      setParticipants((state) => ({
        ...state,
        [run.runId]: {
          items: state[run.runId]?.items ?? [],
          nextCursor: state[run.runId]?.nextCursor ?? null,
          open: true,
          loading: false,
          error: detail,
        },
      }));
    }
  };

  const toggleParticipants = (run: AdminAuctionRun) => {
    const current = participants[run.runId];
    if (!current) {
      void fetchParticipants(run, null, true);
      return;
    }
    setParticipants((state) => ({
      ...state,
      [run.runId]: { ...current, open: !current.open },
    }));
  };

  const downloadReport = () => {
    const auction = auctions.find((item) => item.auctionId === selectedAuctionId);
    const rows = [
      ["aukcja", "produkt", "runda", "start", "koniec", "status", "uczestnicy", "cena_sprzedazy", "oplacono"],
      ...runs.map((run) => [run.auctionId, auction?.productName ?? "", run.runId, run.startsAt, run.endsAt, run.status, run.participantCount, run.soldPrice, run.paidAt]),
    ];
    const csv = `\uFEFF${rows.map((row) => row.map((value) => csvCell(value)).join(";")).join("\r\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `fiszy-raport-${selectedAuctionId}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className={styles.panelSection} aria-labelledby="runs-heading">
      <div className={styles.sectionHeader}>
        <div>
          <p className={styles.eyebrow}>Historia</p>
          <h2 id="runs-heading">Rundy i uczestnicy</h2>
        </div>
        {selectedAuctionId ? (
          <div className={styles.cardActions}>
            {runs.length ? <button className={styles.secondaryButton} type="button" onClick={downloadReport}>Pobierz raport CSV</button> : null}
            <span className={styles.sectionCount} aria-label={`${runs.length} załadowanych rund`}>{runs.length}</span>
          </div>
        ) : null}
      </div>

      <div className={styles.onDemandControls}>
        <div className={styles.runFinder}>
          <label className={styles.field} htmlFor="run-auction-search">
            <span>Szukaj aukcji</span>
            <input id="run-auction-search" className={styles.input} type="search" value={auctionSearch} placeholder="Nazwa, slug lub ID…" onChange={(event) => setAuctionSearch(event.target.value)} />
          </label>
          <label className={styles.field} htmlFor="run-date-filter">
            <span>Termin</span>
            <select id="run-date-filter" className={styles.input} value={dateFilter} onChange={(event) => setDateFilter(event.target.value as typeof dateFilter)}>
              <option value="all">Wszystkie terminy</option>
              <option value="upcoming">Nadchodzące</option>
              <option value="past">Minione</option>
              <option value="undated">Bez terminu</option>
            </select>
          </label>
          <label className={`${styles.field} ${styles.runAuctionSelect}`} htmlFor="run-auction-select">
            <span>Wybierz aukcję ({visibleAuctions.length})</span>
            <select id="run-auction-select" className={styles.input} value={selectedAuctionId} onChange={(event) => selectAuction(event.target.value)}>
              <option value="">Wybierz z katalogu…</option>
              {visibleAuctions.map((auction) => (
                <option key={auction.auctionId} value={auction.auctionId}>
                  {auction.startsAt ? formatDateTime(auction.startsAt) : "Bez terminu"} · {auction.productName} · /{auction.slug}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p>
          Dane są pobierane dopiero po wybraniu aukcji. Rozwiń rundę, aby zobaczyć uczestników.
        </p>
      </div>

      {error ? <p className={styles.errorNotice} role="alert">{error}</p> : null}
      {loading && runs.length === 0 ? (
        <p className={styles.inlineStatus} role="status">Ładuję rundy…</p>
      ) : null}

      {runs.length > 0 ? (
        <div className={styles.runList}>
          {runs.map((run, index) => {
            const participantState = participants[run.runId];
            const contentId = `run-participants-${index}`;
            return (
              <article className={styles.runCard} key={run.runId}>
                <div className={styles.runHeader}>
                  <div>
                    <span className={styles.orderId}>{run.runId}</span>
                    <h3>{formatDateTime(run.startsAt)}</h3>
                  </div>
                  <span className={`${styles.statusPill} ${styles[`status_${run.status ?? "published"}`]}`}>
                    <span aria-hidden="true" />
                    {run.status ? STATUS_LABELS[run.status] : "Brak statusu"}
                  </span>
                </div>

                <dl className={styles.runMeta}>
                  <div>
                    <dt>Koniec</dt>
                    <dd>{formatDateTime(run.endsAt)}</dd>
                  </div>
                  <div>
                    <dt>Uczestnicy</dt>
                    <dd>{run.participantCount ?? participantState?.items.length ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>Cena sprzedaży</dt>
                    <dd>{run.soldPrice !== null ? formatMoney(run.soldPrice) : "—"}</dd>
                  </div>
                  <div>
                    <dt>Zwycięzca</dt>
                    <dd>{run.winnerParticipantId ?? "—"}</dd>
                  </div>
                </dl>

                <button
                  className={styles.secondaryButton}
                  type="button"
                  onClick={() => toggleParticipants(run)}
                  aria-expanded={participantState?.open ?? false}
                  aria-controls={contentId}
                >
                  {participantState?.open ? "Ukryj uczestników" : "Pokaż uczestników"}
                </button>

                {participantState?.open ? (
                  <div className={styles.participantSection} id={contentId}>
                    {participantState.error ? (
                      <p className={styles.errorNotice} role="alert">{participantState.error}</p>
                    ) : null}
                    {participantState.items.length > 0 ? (
                      <ul className={styles.participantList}>
                        {participantState.items.map((participant) => (
                          <li key={participant.participantId}>
                            <div>
                              <code>{participant.participantId}</code>
                              {participant.isWinner ? <strong>Zwycięzca</strong> : null}
                            </div>
                            <span>
                              {participant.entryStatus === "granted"
                                ? "Wejście aktywne"
                                : participant.entryStatus === "refunded"
                                  ? "Wejście zwrócone"
                                  : "Status nieznany"}
                              {participant.grantedAt ? ` · ${formatDateTime(participant.grantedAt)}` : ""}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : participantState.loading ? null : (
                      <p className={styles.inlineStatus}>Brak uczestników w tej rundzie.</p>
                    )}
                    {participantState.loading ? (
                      <p className={styles.inlineStatus} role="status">Ładuję uczestników…</p>
                    ) : null}
                    {participantState.nextCursor && !participantState.loading ? (
                      <button
                        className={styles.ghostButton}
                        type="button"
                        onClick={() => void fetchParticipants(
                          run,
                          participantState.nextCursor,
                          false,
                        )}
                      >
                        Załaduj kolejnych
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : selectedAuctionId && !loading && !error ? (
        <div className={styles.emptyState}>
          <strong>Brak zapisanych rund</strong>
          <span>Rundy pojawią się po ich zaplanowaniu lub uruchomieniu.</span>
        </div>
      ) : !selectedAuctionId ? (
        <div className={styles.emptyState}>
          <strong>Historia jest ładowana na żądanie</strong>
          <span>Wybierz aukcję powyżej, aby rozpocząć.</span>
        </div>
      ) : null}

      {nextCursor && !loading ? (
        <div className={styles.loadMoreRow}>
          <button
            className={styles.secondaryButton}
            type="button"
            onClick={() => void fetchRuns(selectedAuctionId, nextCursor, false)}
          >
            Załaduj starsze rundy
          </button>
        </div>
      ) : null}
    </section>
  );
}
