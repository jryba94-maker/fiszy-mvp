import type {
  AdminAuction,
  AdminOrder,
  AuctionFilter,
  AuctionStatus,
} from "./types";

const currencyFormatter = new Intl.NumberFormat("pl-PL", {
  style: "currency",
  currency: "PLN",
  maximumFractionDigits: 0,
});

const dateFormatter = new Intl.DateTimeFormat("pl-PL", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export const STATUS_LABELS: Record<AuctionStatus, string> = {
  draft: "Szkic",
  waiting: "Oczekuje",
  live: "Live",
  payment_pending: "Płatność",
  sold: "Sprzedana",
  ended: "Zakończona",
};

export function formatMoney(value: number, currency = "pln") {
  if (currency.toLowerCase() === "pln") return currencyFormatter.format(value);
  return `${value} ${currency.toUpperCase()}`;
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? dateFormatter.format(date) : "—";
}

export function formatCountdown(target: string | null, now: number) {
  if (!target) return null;
  const remaining = new Date(target).getTime() - now;
  if (!Number.isFinite(remaining)) return null;
  if (remaining <= 0) return "teraz";

  const totalSeconds = Math.ceil(remaining / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days} d ${hours} godz.`;
  if (hours > 0) return `${hours} godz. ${minutes} min`;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function countdownLabel(auction: AdminAuction, now: number) {
  if (auction.status === "waiting") {
    const countdown = formatCountdown(auction.startsAt, now);
    return countdown ? `Start za ${countdown}` : "Oczekuje na start";
  }
  if (auction.status === "live") {
    const countdown = formatCountdown(auction.endsAt, now);
    return countdown ? `Koniec za ${countdown}` : "Aukcja trwa";
  }
  if (auction.status === "payment_pending") {
    return "Czekamy na płatność zwycięzcy";
  }
  if (auction.status === "sold") return `Sprzedana ${formatDateTime(auction.soldAt)}`;
  if (auction.status === "ended") return `Koniec ${formatDateTime(auction.endsAt)}`;
  return "Nie uruchomiono rundy";
}

export function isAuctionActive(status: AuctionStatus) {
  return status === "waiting" || status === "live" || status === "payment_pending";
}

export function matchesFilter(auction: AdminAuction, filter: AuctionFilter) {
  if (filter === "all") return true;
  if (filter === "finished") {
    return auction.status === "sold" || auction.status === "ended";
  }
  return auction.status === filter;
}

export function sortAuctions(auctions: AdminAuction[]) {
  const priority: Record<AuctionStatus, number> = {
    live: 0,
    payment_pending: 1,
    waiting: 2,
    draft: 3,
    sold: 4,
    ended: 5,
  };

  return [...auctions].sort((left, right) => {
    const statusDifference = priority[left.status] - priority[right.status];
    if (statusDifference !== 0) return statusDifference;

    const leftTime = new Date(left.startsAt ?? 0).getTime() || 0;
    const rightTime = new Date(right.startsAt ?? 0).getTime() || 0;
    return rightTime - leftTime;
  });
}

export function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function orderAddress(order: AdminOrder) {
  const address = order.shippingAddress;
  if (!address) return "Brak adresu dostawy";

  const street = [address.line1, address.line2].filter(Boolean).join(", ");
  const city = [address.postalCode, address.city].filter(Boolean).join(" ");
  return [street, city, address.state, address.country]
    .filter(Boolean)
    .join(" · ") || "Brak adresu dostawy";
}

export function shippingClipboardText(order: AdminOrder) {
  const address = order.shippingAddress;
  const lines = [
    order.customer.name,
    address?.line1,
    address?.line2,
    [address?.postalCode, address?.city].filter(Boolean).join(" "),
    address?.country,
    order.customer.phone,
    order.customer.email,
  ];

  return lines.filter(Boolean).join("\n");
}
