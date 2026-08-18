"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "../AdminDashboard.module.css";

type UserSummary = {
  profile: {
    accountId: string;
    fullName: string;
    phone: string;
    address: { line1: string; postalCode: string; city: string; country: string } | null;
    deletionRequestedAt: string | null;
    createdAt: string;
  };
  administration: {
    status: "active" | "blocked";
    internalNote: string | null;
    revision: number;
  };
};

type UserDetail = UserSummary & {
  activity: Array<{
    auctionId: string;
    runId: string;
    product: string;
    enteredAt: string | null;
    isWinner: boolean;
    winnerPrice: number | null;
    order: { orderId: string; amount: number; paidAt: string } | null;
  }>;
};

type Ticket = {
  ticketId: string;
  accountId: string;
  category: string;
  subject: string;
  message: string;
  orderId: string | null;
  status: "open" | "in_progress" | "resolved";
  adminNote: string | null;
  revision: number;
  createdAt: string;
};

async function adminRequest<T>(path: string, init?: RequestInit) {
  const response = await fetch(path, {
    cache: "no-store",
    ...init,
    headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
  });
  const data = await response.json().catch(() => null) as T;
  if (!response.ok) throw Object.assign(new Error(response.status === 403 ? "Ta rola nie ma dostępu do tej operacji." : "Nie udało się pobrać danych portalu."), { status: response.status });
  return data;
}

export function PortalOperationsPanel({ onSessionExpired }: { onSessionExpired: () => void }) {
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [userCursor, setUserCursor] = useState<string | null>(null);
  const [ticketCursor, setTicketCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<UserDetail | null>(null);
  const [userNote, setUserNote] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [userStatus, setUserStatus] = useState<"all" | "active" | "blocked">("all");
  const [ticketSearch, setTicketSearch] = useState("");
  const [ticketStatus, setTicketStatus] = useState<"all" | Ticket["status"]>("all");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [userResult, ticketResult] = await Promise.all([
        adminRequest<{ users: UserSummary[]; nextCursor: string | null }>("/api/admin/users?limit=50"),
        adminRequest<{ tickets: Ticket[]; nextCursor: string | null }>("/api/admin/support"),
      ]);
      setUsers(userResult.users); setUserCursor(userResult.nextCursor);
      setTickets(ticketResult.tickets); setTicketCursor(ticketResult.nextCursor);
    } catch (loadError) {
      if ((loadError as { status?: number }).status === 401) onSessionExpired();
      else setError(loadError instanceof Error ? loadError.message : "Nie udało się pobrać danych.");
    } finally { setLoading(false); }
  }, [onSessionExpired]);

  useEffect(() => { void load(); }, [load]);

  const filteredUsers = useMemo(() => {
    const query = userSearch.trim().toLocaleLowerCase("pl-PL");
    return users.filter((user) => {
      const matchesStatus = userStatus === "all" || user.administration.status === userStatus;
      const haystack = [user.profile.fullName, user.profile.phone, user.profile.accountId]
        .join(" ")
        .toLocaleLowerCase("pl-PL");
      return matchesStatus && (!query || haystack.includes(query));
    });
  }, [userSearch, userStatus, users]);

  const filteredTickets = useMemo(() => {
    const query = ticketSearch.trim().toLocaleLowerCase("pl-PL");
    return tickets.filter((ticket) => {
      const matchesStatus = ticketStatus === "all" || ticket.status === ticketStatus;
      const haystack = [ticket.ticketId, ticket.subject, ticket.message, ticket.orderId ?? ""]
        .join(" ")
        .toLocaleLowerCase("pl-PL");
      return matchesStatus && (!query || haystack.includes(query));
    });
  }, [ticketSearch, ticketStatus, tickets]);

  const loadMoreUsers = async () => {
    if (!userCursor) return;
    setBusy("users-more"); setError("");
    try {
      const result = await adminRequest<{ users: UserSummary[]; nextCursor: string | null }>(`/api/admin/users?limit=50&cursor=${encodeURIComponent(userCursor)}`);
      setUsers((current) => [...current, ...result.users]);
      setUserCursor(result.nextCursor);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Nie udało się pobrać kolejnych użytkowników."); }
    finally { setBusy(""); }
  };

  const loadMoreTickets = async () => {
    if (!ticketCursor) return;
    setBusy("tickets-more"); setError("");
    try {
      const result = await adminRequest<{ tickets: Ticket[]; nextCursor: string | null }>(`/api/admin/support?cursor=${encodeURIComponent(ticketCursor)}`);
      setTickets((current) => [...current, ...result.tickets]);
      setTicketCursor(result.nextCursor);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Nie udało się pobrać kolejnych zgłoszeń."); }
    finally { setBusy(""); }
  };

  const openUser = async (accountId: string) => {
    setBusy(`user-${accountId}`); setError("");
    try {
      const detail = await adminRequest<UserDetail & { profile: UserDetail["profile"]; administration: UserDetail["administration"] }>(`/api/admin/users/${encodeURIComponent(accountId)}`);
      setSelected(detail); setUserNote(detail.administration.internalNote ?? "");
    } catch (openError) { setError(openError instanceof Error ? openError.message : "Nie udało się otworzyć użytkownika."); }
    finally { setBusy(""); }
  };

  const saveUser = async (status: "active" | "blocked") => {
    if (!selected) return;
    setBusy(`user-save-${selected.profile.accountId}`);
    try {
      const result = await adminRequest<{ administration: UserSummary["administration"] }>(`/api/admin/users/${encodeURIComponent(selected.profile.accountId)}`, {
        method: "PATCH",
        body: JSON.stringify({ expectedRevision: selected.administration.revision, status, internalNote: userNote || null }),
      });
      setSelected({ ...selected, administration: result.administration });
      setUsers((current) => current.map((item) => item.profile.accountId === selected.profile.accountId ? { ...item, administration: result.administration } : item));
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Nie udało się zapisać użytkownika."); }
    finally { setBusy(""); }
  };

  const updateTicket = async (ticket: Ticket, status: Ticket["status"], adminNote: string) => {
    setBusy(ticket.ticketId);
    try {
      const result = await adminRequest<{ ticket: Ticket }>(`/api/admin/support/${encodeURIComponent(ticket.ticketId)}`, {
        method: "PATCH",
        body: JSON.stringify({ expectedRevision: ticket.revision, status, adminNote: adminNote || null }),
      });
      setTickets((current) => current.map((item) => item.ticketId === ticket.ticketId ? result.ticket : item));
    } catch (ticketError) { setError(ticketError instanceof Error ? ticketError.message : "Nie udało się zapisać zgłoszenia."); }
    finally { setBusy(""); }
  };

  return (
    <section className={styles.portalOperations} aria-labelledby="portal-operations-title" aria-busy={loading}>
      <div className={styles.sectionHeader}>
        <div><p className={styles.eyebrow}>Relacje i bezpieczeństwo</p><h2 id="portal-operations-title">Użytkownicy i pomoc</h2></div>
        <button className={styles.secondaryButton} type="button" onClick={() => void load()} disabled={loading}>Odśwież</button>
      </div>
      {error ? <div className={styles.inlineError} role="alert">{error}</div> : null}
      <div className={styles.portalOperationsGrid}>
        <div className={styles.adminSubpanel}>
          <div className={styles.subpanelTitle}><h3>Użytkownicy</h3><span>{users.length} wczytanych</span></div>
          <div className={styles.portalFilters} role="search" aria-label="Filtrowanie użytkowników">
            <input type="search" value={userSearch} placeholder="Szukaj użytkownika…" aria-label="Szukaj użytkownika" onChange={(event) => setUserSearch(event.target.value)} />
            <select value={userStatus} aria-label="Status użytkownika" onChange={(event) => setUserStatus(event.target.value as typeof userStatus)}><option value="all">Wszystkie konta</option><option value="active">Aktywne</option><option value="blocked">Zablokowane</option></select>
          </div>
          {filteredUsers.length ? <div className={styles.compactList}>{filteredUsers.map((user) => (
            <button className={styles.userRow} type="button" key={user.profile.accountId} onClick={() => void openUser(user.profile.accountId)} disabled={busy === `user-${user.profile.accountId}`}>
              <span><strong>{user.profile.fullName || "Profil bez nazwy"}</strong><small>{user.profile.phone || "Brak telefonu"}</small></span>
              <em className={user.administration.status === "blocked" ? styles.blockedBadge : styles.activeBadge}>{user.administration.status === "blocked" ? "Zablokowany" : "Aktywny"}</em>
            </button>
          ))}</div> : <p className={styles.emptyState}>{users.length ? "Brak użytkowników pasujących do filtrów." : "Brak utworzonych profili użytkowników."}</p>}
          {userCursor ? <button className={styles.secondaryButton} type="button" disabled={busy === "users-more"} onClick={() => void loadMoreUsers()}>{busy === "users-more" ? "Pobieram…" : "Pokaż kolejnych użytkowników"}</button> : null}

          {selected ? <div className={styles.userDetail}>
            <div className={styles.subpanelTitle}><h3>{selected.profile.fullName || "Użytkownik"}</h3><button type="button" onClick={() => setSelected(null)}>Zamknij</button></div>
            <dl><div><dt>Telefon</dt><dd>{selected.profile.phone || "—"}</dd></div><div><dt>Adres</dt><dd>{selected.profile.address ? `${selected.profile.address.line1}, ${selected.profile.address.postalCode} ${selected.profile.address.city}` : "—"}</dd></div><div><dt>Aktywność</dt><dd>{selected.activity.length} ostatnich wpisów</dd></div><div><dt>Usunięcie danych</dt><dd>{selected.profile.deletionRequestedAt ? "Wnioskowane" : "Nie"}</dd></div></dl>
            <label className={styles.adminNoteField}><span>Notatka wewnętrzna</span><textarea rows={4} maxLength={2000} value={userNote} onChange={(event) => setUserNote(event.target.value)} /></label>
            <div className={styles.detailActions}><button type="button" onClick={() => void saveUser(selected.administration.status)} disabled={busy.startsWith("user-save-")}>Zapisz notatkę</button><button className={selected.administration.status === "blocked" ? styles.restoreButton : styles.blockButton} type="button" onClick={() => void saveUser(selected.administration.status === "blocked" ? "active" : "blocked")} disabled={busy.startsWith("user-save-")}>{selected.administration.status === "blocked" ? "Odblokuj konto" : "Zablokuj konto"}</button></div>
            {selected.activity.length ? <div className={styles.userActivity}>{selected.activity.slice(0, 8).map((item) => <div key={`${item.auctionId}:${item.runId}`}><span>{item.product}</span><strong>{item.order ? `Zamówienie ${item.order.orderId}` : item.isWinner ? "Wygrana" : "Udział"}</strong></div>)}</div> : null}
          </div> : null}
        </div>

        <div className={styles.adminSubpanel}>
          <div className={styles.subpanelTitle}><h3>Zgłoszenia</h3><span>{tickets.filter((ticket) => ticket.status !== "resolved").length} otwartych</span></div>
          <div className={styles.portalFilters} role="search" aria-label="Filtrowanie zgłoszeń">
            <input type="search" value={ticketSearch} placeholder="Szukaj zgłoszenia…" aria-label="Szukaj zgłoszenia" onChange={(event) => setTicketSearch(event.target.value)} />
            <select value={ticketStatus} aria-label="Status zgłoszenia" onChange={(event) => setTicketStatus(event.target.value as typeof ticketStatus)}><option value="all">Wszystkie statusy</option><option value="open">Nowe</option><option value="in_progress">W realizacji</option><option value="resolved">Zamknięte</option></select>
          </div>
          {filteredTickets.length ? <div className={styles.ticketAdminList}>{filteredTickets.map((ticket) => <TicketEditor key={ticket.ticketId} ticket={ticket} busy={busy === ticket.ticketId} onSave={updateTicket} />)}</div> : <p className={styles.emptyState}>{tickets.length ? "Brak zgłoszeń pasujących do filtrów." : "Brak zgłoszeń użytkowników."}</p>}
          {ticketCursor ? <button className={styles.secondaryButton} type="button" disabled={busy === "tickets-more"} onClick={() => void loadMoreTickets()}>{busy === "tickets-more" ? "Pobieram…" : "Pokaż kolejne zgłoszenia"}</button> : null}
        </div>
      </div>
    </section>
  );
}

function TicketEditor({ ticket, busy, onSave }: { ticket: Ticket; busy: boolean; onSave: (ticket: Ticket, status: Ticket["status"], note: string) => Promise<void> }) {
  const [status, setStatus] = useState(ticket.status);
  const [note, setNote] = useState(ticket.adminNote ?? "");
  useEffect(() => { setStatus(ticket.status); setNote(ticket.adminNote ?? ""); }, [ticket]);
  return <article className={styles.adminTicket}>
    <div className={styles.ticketTop}><span>{ticket.ticketId}</span><strong>{ticket.subject}</strong></div>
    <p>{ticket.message}</p>
    <small>Konto: {ticket.accountId.slice(0, 18)}{ticket.orderId ? ` · Zamówienie: ${ticket.orderId}` : ""}</small>
    <label><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value as Ticket["status"])}><option value="open">Nowe</option><option value="in_progress">W realizacji</option><option value="resolved">Zamknięte</option></select></label>
    <label><span>Odpowiedź widoczna dla użytkownika</span><textarea rows={3} maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} /></label>
    <button type="button" disabled={busy} onClick={() => void onSave(ticket, status, note)}>{busy ? "Zapisuję…" : "Zapisz odpowiedź"}</button>
  </article>;
}
