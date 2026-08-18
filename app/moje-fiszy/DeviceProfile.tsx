"use client";

import { SignInButton, useUser } from "@clerk/nextjs";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { fetchAuctionDetail, type PublicAuction } from "../components/public/auction-data";
import { PublicHeader } from "../components/public/PublicHeader";
import { SafeAuctionImage } from "../components/public/SafeAuctionImage";
import styles from "./page.module.css";

type Preferences = {
  emailAuctionStart: boolean;
  emailWin: boolean;
  emailOrderUpdates: boolean;
  marketing: boolean;
  analytics: boolean;
};

type Profile = {
  revision: number;
  fullName: string;
  phone: string;
  address: { label: string; line1: string; line2: string | null; postalCode: string; city: string; country: string } | null;
  preferences: Preferences;
  deletionRequestedAt: string | null;
};

type Fulfillment = {
  status: "new" | "preparing" | "shipped" | "delivered";
  carrier?: string | null;
  trackingNumber?: string | null;
};

type Activity = {
  auctionId: string;
  runId: string;
  product: string;
  productImageUrl: string | null;
  entryStatus: "granted" | "refunded";
  entryFee: number;
  enteredAt: string;
  outcome: "participating" | "lost" | "won_payment_pending" | "won_paid";
  winnerPrice: number | null;
  order: { orderId: string; amount: number; currency: string; paidAt: string; fulfillment: Fulfillment | null } | null;
};

type Ticket = {
  ticketId: string;
  category: "account" | "auction" | "order" | "complaint" | "other";
  subject: string;
  status: "open" | "in_progress" | "resolved";
  adminNote: string | null;
};

type ProfileDraft = {
  fullName: string;
  phone: string;
  label: string;
  line1: string;
  line2: string;
  postalCode: string;
  city: string;
  country: string;
  preferences: Preferences;
};

const defaultPreferences: Preferences = {
  emailAuctionStart: true,
  emailWin: true,
  emailOrderUpdates: true,
  marketing: false,
  analytics: false,
};

function draftFrom(profile: Profile): ProfileDraft {
  return {
    fullName: profile.fullName,
    phone: profile.phone,
    label: profile.address?.label ?? "Dom",
    line1: profile.address?.line1 ?? "",
    line2: profile.address?.line2 ?? "",
    postalCode: profile.address?.postalCode ?? "",
    city: profile.address?.city ?? "",
    country: profile.address?.country ?? "Polska",
    preferences: profile.preferences ?? defaultPreferences,
  };
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("pl-PL", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function money(value: number, currency = "pln") {
  return new Intl.NumberFormat("pl-PL", { style: "currency", currency: currency.toUpperCase() }).format(value);
}

function activityLabel(item: Activity) {
  if (item.outcome === "won_paid") return "Wygrana opłacona";
  if (item.outcome === "won_payment_pending") return "Czeka na płatność";
  if (item.entryStatus === "refunded") return "Wejście zwrócone";
  if (item.outcome === "lost") return "Aukcja zakończona";
  return "Uczestniczysz";
}

function deliveryLabel(status?: Fulfillment["status"]) {
  if (status === "preparing") return "Przygotowujemy przesyłkę";
  if (status === "shipped") return "Przesyłka nadana";
  if (status === "delivered") return "Dostarczono";
  return "Zamówienie przyjęte";
}

async function accountRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    cache: "no-store",
    ...init,
    headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
  });
  const data = await response.json().catch(() => null) as T;
  if (!response.ok) {
    throw new Error(response.status === 401
      ? "Sesja wygasła. Zaloguj się ponownie."
      : response.status === 409
        ? "Profil zmienił się w innej karcie. Odśwież stronę."
        : "Nie udało się pobrać danych konta.");
  }
  return data;
}

export function DeviceProfile() {
  const { isLoaded, isSignedIn, user } = useUser();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [watchedIds, setWatchedIds] = useState<string[]>([]);
  const [watchedAuctions, setWatchedAuctions] = useState<PublicAuction[]>([]);
  const [readNotificationIds, setReadNotificationIds] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [ticketDraft, setTicketDraft] = useState({ category: "other" as Ticket["category"], subject: "", message: "", orderId: "" });

  const loadPortal = useCallback(async () => {
    if (!isSignedIn) return;
    setLoading(true);
    setError("");
    try {
      const [profileResult, activityResult, watchResult, ticketResult, notificationResult] = await Promise.all([
        accountRequest<{ profile: Profile }>("/api/account/profile"),
        accountRequest<{ activity: Activity[]; nextCursor: string | null }>("/api/account/activity"),
        accountRequest<{ auctionIds: string[] }>("/api/account/watchlist"),
        accountRequest<{ tickets: Ticket[] }>("/api/account/support"),
        accountRequest<{ readIds: string[] }>("/api/account/notifications"),
      ]);
      setProfile(profileResult.profile);
      setDraft(draftFrom(profileResult.profile));
      setActivity(activityResult.activity);
      setHistoryCursor(activityResult.nextCursor);
      setWatchedIds(watchResult.auctionIds);
      setTickets(ticketResult.tickets);
      setReadNotificationIds(new Set(notificationResult.readIds));
      const watched = await Promise.allSettled(
        watchResult.auctionIds.slice(0, 20).map((auctionId) => fetchAuctionDetail(auctionId)),
      );
      setWatchedAuctions(watched.flatMap((result) => result.status === "fulfilled" ? [result.value] : []));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Nie udało się załadować konta.");
    } finally {
      setLoading(false);
    }
  }, [isSignedIn]);

  useEffect(() => {
    if (isLoaded && isSignedIn) void loadPortal();
    if (isLoaded && !isSignedIn) setLoading(false);
  }, [isLoaded, isSignedIn, loadPortal]);

  const stats = useMemo(() => ({
    entries: activity.length,
    wins: activity.filter((item) => item.outcome.startsWith("won_")).length,
    orders: activity.filter((item) => item.order).length,
    watched: watchedIds.length,
  }), [activity, watchedIds]);

  const allNotifications = useMemo(() => [
    ...activity.flatMap((item) => {
      if (item.outcome === "won_payment_pending") return [{ id: `win-${item.runId}`, title: "Masz wygraną do opłacenia", text: item.product }];
      if (item.order?.fulfillment?.status === "shipped") return [{ id: `ship-${item.order.orderId}`, title: "Przesyłka została nadana", text: item.product }];
      if (item.order?.fulfillment?.status === "delivered") return [{ id: `done-${item.order.orderId}`, title: "Zamówienie dostarczone", text: item.product }];
      return [];
    }),
    ...tickets.filter((ticket) => ticket.adminNote).map((ticket) => ({ id: ticket.ticketId, title: "Odpowiedź na zgłoszenie", text: ticket.subject })),
  ], [activity, tickets]);

  const notifications = useMemo(
    () => allNotifications.filter((item) => !readNotificationIds.has(item.id)),
    [allNotifications, readNotificationIds],
  );

  const markNotificationsRead = async () => {
    const notificationIds = notifications.map((item) => item.id);
    if (!notificationIds.length || busy) return;
    setBusy("notifications"); setError("");
    try {
      const result = await accountRequest<{ readIds: string[] }>("/api/account/notifications", {
        method: "PATCH",
        body: JSON.stringify({ notificationIds }),
      });
      setReadNotificationIds((current) => new Set([...current, ...result.readIds]));
      setNotice("Powiadomienia oznaczono jako przeczytane.");
    } catch (notificationError) {
      setError(notificationError instanceof Error ? notificationError.message : "Nie udało się zapisać powiadomień.");
    } finally {
      setBusy("");
    }
  };

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    if (!profile || !draft) return;
    setBusy("profile"); setError(""); setNotice("");
    const hasAddress = Boolean(draft.line1 || draft.postalCode || draft.city);
    try {
      const result = await accountRequest<{ profile: Profile }>("/api/account/profile", {
        method: "PATCH",
        body: JSON.stringify({
          expectedRevision: profile.revision,
          profile: {
            fullName: draft.fullName,
            phone: draft.phone,
            address: hasAddress ? { label: draft.label, line1: draft.line1, line2: draft.line2 || null, postalCode: draft.postalCode, city: draft.city, country: draft.country } : null,
            preferences: draft.preferences,
          },
        }),
      });
      setProfile(result.profile); setDraft(draftFrom(result.profile)); setNotice("Profil i ustawienia zostały zapisane.");
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : "Nie udało się zapisać profilu."); }
    finally { setBusy(""); }
  };

  const loadMoreHistory = async () => {
    if (!historyCursor || busy) return;
    setBusy("history");
    try {
      const result = await accountRequest<{ activity: Activity[]; nextCursor: string | null }>(`/api/account/activity?cursor=${encodeURIComponent(historyCursor)}`);
      setActivity((current) => [...current, ...result.activity]); setHistoryCursor(result.nextCursor);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Nie udało się pobrać historii."); }
    finally { setBusy(""); }
  };

  const removeWatch = async (auctionId: string) => {
    setBusy(`watch-${auctionId}`);
    try {
      await accountRequest("/api/account/watchlist", { method: "PATCH", body: JSON.stringify({ auctionId, watched: false }) });
      setWatchedIds((current) => current.filter((id) => id !== auctionId));
      setWatchedAuctions((current) => current.filter((item) => item.auctionId !== auctionId));
    } catch (watchError) { setError(watchError instanceof Error ? watchError.message : "Nie udało się zmienić listy."); }
    finally { setBusy(""); }
  };

  const submitTicket = async (event: FormEvent) => {
    event.preventDefault(); setBusy("ticket"); setError("");
    try {
      const result = await accountRequest<{ ticket: Ticket }>("/api/account/support", { method: "POST", body: JSON.stringify({ ...ticketDraft, orderId: ticketDraft.orderId || null }) });
      setTickets((current) => [result.ticket, ...current]);
      setTicketDraft({ category: "other", subject: "", message: "", orderId: "" });
      setNotice(`Zgłoszenie ${result.ticket.ticketId} zostało zapisane.`);
    } catch (ticketError) { setError(ticketError instanceof Error ? ticketError.message : "Nie udało się wysłać zgłoszenia."); }
    finally { setBusy(""); }
  };

  const requestDeletion = async () => {
    if (!window.confirm("Zgłosić usunięcie konta i danych, które nie muszą być przechowywane prawnie?")) return;
    setBusy("deletion");
    try {
      const result = await accountRequest<{ profile: Profile }>("/api/account/profile", { method: "DELETE" });
      setProfile(result.profile); setNotice("Wniosek o usunięcie danych został zapisany.");
    } catch (deleteError) { setError(deleteError instanceof Error ? deleteError.message : "Nie udało się zapisać wniosku."); }
    finally { setBusy(""); }
  };

  return (
    <main className={styles.page}>
      <PublicHeader profileActive />
      <div className={styles.main}>
        <section className={styles.intro} aria-labelledby="profile-title">
          <div><p className={styles.eyebrow}>Centrum użytkownika</p><h1 id="profile-title">Moje Fiszy</h1></div>
          <p className={styles.introText}>Aukcje, wygrane, zamówienia, powiadomienia i pomoc — na każdym urządzeniu po zalogowaniu.</p>
        </section>

        {!isLoaded || loading ? (
          <section className={styles.empty} role="status" aria-busy="true"><div><h2>Ładujemy Twoje konto…</h2><p>Łączymy historię aukcji z bezpiecznym profilem.</p></div></section>
        ) : !isSignedIn ? (
          <section className={styles.signInCard}>
            <div><p className={styles.eyebrow}>Jedno konto na wszystkich urządzeniach</p><h2>Zaloguj się, aby zobaczyć swoje aukcje</h2><p>Możesz użyć adresu e-mail albo konta Google. Logowanie obsługuje Clerk.</p></div>
            <SignInButton mode="modal"><button className={styles.primaryButton} type="button">Zaloguj się</button></SignInButton>
          </section>
        ) : (
          <>
            {error ? <div className={styles.error} role="alert">{error}</div> : null}
            {notice ? <div className={styles.notice} role="status">{notice}</div> : null}

            <section className={styles.accountBar}>
              <div><span className={styles.accountAvatar} aria-hidden="true">{(profile?.fullName || user?.firstName || user?.primaryEmailAddress?.emailAddress || "F").slice(0, 1).toUpperCase()}</span><div><strong>{profile?.fullName || user?.fullName || "Twoje konto Fiszy"}</strong><span>{user?.primaryEmailAddress?.emailAddress}</span></div></div>
              <a className={styles.secondaryButton} href="/api/account/export">Pobierz moje dane</a>
            </section>

            <div className={styles.stats} role="group" aria-label="Podsumowanie konta">
              <div className={styles.stat}><span className={styles.statValue}>{stats.entries}</span><span className={styles.statLabel}>wczytane wejścia</span></div>
              <div className={styles.stat}><span className={styles.statValue}>{stats.wins}</span><span className={styles.statLabel}>wygrane w historii</span></div>
              <div className={styles.stat}><span className={styles.statValue}>{stats.orders}</span><span className={styles.statLabel}>zamówienia w historii</span></div>
              <div className={styles.stat}><span className={styles.statValue}>{stats.watched}</span><span className={styles.statLabel}>obserwowane</span></div>
            </div>

            <section className={styles.portalGrid} aria-label="Najważniejsze informacje">
              <article className={styles.panel}>
                <div className={styles.panelHeading}><div><p className={styles.eyebrow}>Teraz</p><h2>Powiadomienia</h2></div><span className={styles.counter}>{notifications.length}</span></div>
                {notifications.length ? <><div className={styles.notificationList}>{notifications.map((item) => <div className={styles.notification} key={item.id}><div><strong>{item.title}</strong><span>{item.text}</span></div></div>)}</div><button className={styles.notificationButton} type="button" disabled={busy === "notifications"} onClick={() => void markNotificationsRead()}>{busy === "notifications" ? "Zapisuję…" : "Oznacz wszystkie jako przeczytane"}</button></> : <p className={styles.muted}>Nie masz teraz nowych spraw wymagających działania.</p>}
                <p className={styles.integrationNote}>Powiadomienia w portalu działają. E-mail wymaga jeszcze zweryfikowanej domeny nadawczej.</p>
              </article>
              <article className={styles.panel}>
                <div className={styles.panelHeading}><div><p className={styles.eyebrow}>Lista</p><h2>Obserwowane</h2></div><span className={styles.counter}>{watchedIds.length}</span></div>
                {watchedAuctions.length ? <div className={styles.watchList}>{watchedAuctions.map((auction) => <div className={styles.watchItem} key={auction.auctionId}><div><strong>{auction.product}</strong><span>{dateLabel(auction.startsAt)}</span></div><div className={styles.watchActions}><Link href={`/aukcje/${encodeURIComponent(auction.auctionId)}`}>Otwórz</Link><button type="button" disabled={busy === `watch-${auction.auctionId}`} onClick={() => void removeWatch(auction.auctionId)}>Usuń</button></div></div>)}</div> : <p className={styles.muted}>Dodaj aukcje do obserwowanych w katalogu.</p>}
                <Link className={styles.inlineLink} href="/#aukcje">Przejdź do katalogu</Link>
              </article>
            </section>

            <section className={styles.section} aria-labelledby="activity-title">
              <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>Historia konta</p><h2 id="activity-title">Aukcje i zamówienia</h2></div><p>Dane są przypisane do konta, nie do przeglądarki.</p></div>
              {activity.length ? <div className={styles.list}>{activity.map((item) => <article className={styles.record} key={`${item.auctionId}:${item.runId}`}>
                <SafeAuctionImage src={item.productImageUrl} alt={item.product} sizes="(max-width: 680px) 100vw, 180px" frameClassName={styles.recordImage} />
                <div className={styles.recordBody}><div className={styles.recordTop}><div><span className={styles.outcome}>{activityLabel(item)}</span><h3>{item.product}</h3></div><span className={styles.updated}>{dateLabel(item.enteredAt)}</span></div>
                  <div className={styles.recordDetails}><span>Wejście: {money(item.entryFee)}</span>{item.winnerPrice !== null ? <span>Cena wygranej: {money(item.winnerPrice)}</span> : null}{item.order ? <span>{deliveryLabel(item.order.fulfillment?.status)}</span> : null}</div>
                  {item.order ? <div className={styles.orderLine}><span>Zamówienie {item.order.orderId} · {money(item.order.amount, item.order.currency)}</span>{item.order.fulfillment?.trackingNumber ? <strong>{item.order.fulfillment.carrier}: {item.order.fulfillment.trackingNumber}</strong> : null}</div> : null}
                  <Link className={styles.recordLink} href={`/aukcje/${encodeURIComponent(item.auctionId)}`}>Zobacz aukcję</Link>
                </div></article>)}</div> : <div className={styles.emptyCompact}><h3>Jeszcze tu pusto</h3><p>Twoje pierwsze wejście do aukcji pojawi się tutaj automatycznie.</p></div>}
              {historyCursor ? <button className={styles.moreButton} type="button" disabled={busy === "history"} onClick={() => void loadMoreHistory()}>{busy === "history" ? "Pobieram…" : "Pokaż starsze"}</button> : null}
            </section>

            <section className={styles.section} aria-labelledby="profile-edit-title">
              <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>Dane i prywatność</p><h2 id="profile-edit-title">Twój profil</h2></div><p>Adres wykorzystamy dopiero przy realizacji wygranej.</p></div>
              {draft && profile ? <form className={styles.profileForm} onSubmit={saveProfile}>
                <label><span>Imię i nazwisko</span><input value={draft.fullName} maxLength={100} autoComplete="name" onChange={(event) => setDraft({ ...draft, fullName: event.target.value })} /></label>
                <label><span>Telefon</span><input value={draft.phone} maxLength={32} autoComplete="tel" onChange={(event) => setDraft({ ...draft, phone: event.target.value })} /></label>
                <label><span>Nazwa adresu</span><input value={draft.label} maxLength={40} onChange={(event) => setDraft({ ...draft, label: event.target.value })} /></label>
                <label className={styles.wide}><span>Ulica i numer</span><input value={draft.line1} maxLength={120} autoComplete="address-line1" onChange={(event) => setDraft({ ...draft, line1: event.target.value })} /></label>
                <label className={styles.wide}><span>Adres — ciąg dalszy</span><input value={draft.line2} maxLength={120} autoComplete="address-line2" onChange={(event) => setDraft({ ...draft, line2: event.target.value })} /></label>
                <label><span>Kod pocztowy</span><input value={draft.postalCode} maxLength={20} autoComplete="postal-code" onChange={(event) => setDraft({ ...draft, postalCode: event.target.value })} /></label>
                <label><span>Miasto</span><input value={draft.city} maxLength={80} autoComplete="address-level2" onChange={(event) => setDraft({ ...draft, city: event.target.value })} /></label>
                <label className={styles.wide}><span>Kraj</span><input value={draft.country} maxLength={80} autoComplete="country-name" onChange={(event) => setDraft({ ...draft, country: event.target.value })} /></label>
                <fieldset className={styles.preferences}><legend>Powiadomienia i zgody</legend>{([
                  ["emailAuctionStart", "Przypomnienia o starcie obserwowanych aukcji"], ["emailWin", "Informacje o wygranej i wymaganym działaniu"], ["emailOrderUpdates", "Zmiany statusu zamówienia i wysyłki"], ["marketing", "Nowe aukcje i promocje"], ["analytics", "Dobrowolna analityka portalu"],
                ] as const).map(([key, label]) => <label className={styles.checkLabel} key={key}><input type="checkbox" checked={draft.preferences[key]} onChange={(event) => setDraft({ ...draft, preferences: { ...draft.preferences, [key]: event.target.checked } })} /><span>{label}</span></label>)}</fieldset>
                <div className={styles.formActions}><button className={styles.primaryButton} type="submit" disabled={busy === "profile"}>{busy === "profile" ? "Zapisuję…" : "Zapisz profil"}</button><a className={styles.secondaryButton} href="/api/account/export">Eksport danych</a><button className={styles.dangerButton} type="button" disabled={busy === "deletion" || Boolean(profile.deletionRequestedAt)} onClick={() => void requestDeletion()}>{profile.deletionRequestedAt ? "Wniosek przyjęty" : "Poproś o usunięcie danych"}</button></div>
              </form> : null}
            </section>

            <section className={styles.section} id="pomoc" aria-labelledby="support-title">
              <div className={styles.sectionHeading}><div><p className={styles.eyebrow}>Pomoc i reklamacje</p><h2 id="support-title">Napisz do nas</h2></div><p>Każde zgłoszenie otrzymuje numer i własny status.</p></div>
              <div className={styles.supportGrid}><form className={styles.ticketForm} onSubmit={submitTicket}>
                <label><span>Rodzaj sprawy</span><select value={ticketDraft.category} onChange={(event) => setTicketDraft({ ...ticketDraft, category: event.target.value as Ticket["category"] })}><option value="account">Konto</option><option value="auction">Aukcja</option><option value="order">Zamówienie</option><option value="complaint">Reklamacja lub zwrot</option><option value="other">Inna sprawa</option></select></label>
                <label><span>Temat</span><input required minLength={3} maxLength={120} value={ticketDraft.subject} onChange={(event) => setTicketDraft({ ...ticketDraft, subject: event.target.value })} /></label>
                <label><span>Numer zamówienia (opcjonalnie)</span><input maxLength={200} value={ticketDraft.orderId} onChange={(event) => setTicketDraft({ ...ticketDraft, orderId: event.target.value })} /></label>
                <label><span>Opis</span><textarea required minLength={10} maxLength={3000} rows={6} value={ticketDraft.message} onChange={(event) => setTicketDraft({ ...ticketDraft, message: event.target.value })} /></label>
                <button className={styles.primaryButton} type="submit" disabled={busy === "ticket"}>{busy === "ticket" ? "Wysyłam…" : "Utwórz zgłoszenie"}</button>
              </form><div className={styles.ticketList}>{tickets.length ? tickets.map((ticket) => <article className={styles.ticket} key={ticket.ticketId}><div><span>{ticket.ticketId}</span><strong>{ticket.subject}</strong></div><span className={styles.ticketStatus}>{ticket.status === "open" ? "Nowe" : ticket.status === "in_progress" ? "W realizacji" : "Zamknięte"}</span>{ticket.adminNote ? <p><strong>Odpowiedź:</strong> {ticket.adminNote}</p> : <p>Oczekuje na odpowiedź zespołu.</p>}</article>) : <div className={styles.emptyCompact}><h3>Brak zgłoszeń</h3><p>Gdy napiszesz do nas, status sprawy zobaczysz tutaj.</p></div>}</div></div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
