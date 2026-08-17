import type {
  AdminAuction,
  AdminOrder,
  AuctionDisplayStatus,
  AuctionFilter,
  AuctionRunStatus,
  FulfillmentStatus,
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

const CSV_FORMULA_PREFIX = /^[\t\r\n ]*[=+\-@]/;

export const STATUS_LABELS: Record<AuctionDisplayStatus, string> = {
  draft: "Szkic",
  published: "Opublikowana",
  archived: "Archiwalna",
  waiting: "Oczekuje",
  live: "Live",
  payment_pending: "Finalizacja",
  sold: "Sprzedana",
  ended: "Zakończona",
};

export const FULFILLMENT_LABELS: Record<FulfillmentStatus, string> = {
  new: "Nowe",
  preparing: "W przygotowaniu",
  shipped: "Wysłane",
  delivered: "Dostarczone",
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

export function auctionDisplayStatus(auction: AdminAuction): AuctionDisplayStatus {
  if (auction.recordState === "archived") return "archived";
  if (auction.recordState === "draft") return "draft";
  return auction.status ?? "published";
}

export function countdownLabel(auction: AdminAuction, now: number) {
  if (auction.recordState === "archived") return "Aukcja ukryta w archiwum";
  if (auction.recordState === "draft") return "Szkic bez aktywnej rundy";
  if (auction.status === "waiting") {
    const countdown = formatCountdown(auction.startsAt, now);
    return countdown ? `Start za ${countdown}` : "Oczekuje na start";
  }
  if (auction.status === "live") {
    const countdown = formatCountdown(auction.endsAt, now);
    return countdown ? `Koniec za ${countdown}` : "Aukcja trwa";
  }
  if (auction.status === "payment_pending") {
    return "Zwycięzca finalizuje zakup";
  }
  if (auction.status === "sold") return `Sprzedana ${formatDateTime(auction.soldAt)}`;
  if (auction.status === "ended") return `Koniec ${formatDateTime(auction.endsAt)}`;
  return "Brak uruchomionej rundy";
}

export function isAuctionActive(status: AuctionRunStatus | null) {
  return status === "waiting" || status === "live" || status === "payment_pending";
}

export function matchesFilter(auction: AdminAuction, filter: AuctionFilter) {
  if (filter === "all") return true;
  if (filter === "archived") return auction.recordState === "archived";
  if (filter === "draft") return auction.recordState === "draft";
  if (auction.recordState === "archived") return false;
  if (filter === "finished") {
    return auction.status === "sold" || auction.status === "ended";
  }
  return auction.status === filter;
}

export function matchesAuctionSearch(auction: AdminAuction, query: string) {
  const normalized = query.trim().toLocaleLowerCase("pl-PL");
  if (!normalized) return true;
  return [auction.productName, auction.slug, auction.auctionId]
    .some((value) => value.toLocaleLowerCase("pl-PL").includes(normalized));
}

export function matchesOrderSearch(order: AdminOrder, query: string) {
  const normalized = query.trim().toLocaleLowerCase("pl-PL");
  if (!normalized) return true;
  return [
    order.orderId,
    order.product,
    order.customer.name,
    order.customer.email,
    order.customer.phone,
    order.fulfillment.carrier,
    order.fulfillment.trackingNumber,
  ].some((value) => value?.toLocaleLowerCase("pl-PL").includes(normalized));
}

export function sortAuctions(auctions: AdminAuction[]) {
  const priority: Record<AuctionDisplayStatus, number> = {
    live: 0,
    payment_pending: 1,
    waiting: 2,
    published: 3,
    draft: 4,
    sold: 5,
    ended: 6,
    archived: 7,
  };

  return [...auctions].sort((left, right) => {
    const statusDifference =
      priority[auctionDisplayStatus(left)] - priority[auctionDisplayStatus(right)];
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

function csvCell(value: string | number | null | undefined) {
  const raw = value === null || value === undefined ? "" : String(value);
  const neutralized = CSV_FORMULA_PREFIX.test(raw) ? `'${raw}` : raw;
  return `"${neutralized.replace(/"/g, '""')}"`;
}

export function ordersCsv(orders: AdminOrder[]) {
  const header = [
    "ID zamówienia",
    "Produkt",
    "Kwota",
    "Waluta",
    "Opłacono",
    "Status realizacji",
    "Przewoźnik",
    "Numer przesyłki",
    "Klient",
    "E-mail",
    "Telefon",
    "Adres",
    "Notatka",
    "Aktualizacja realizacji",
  ];
  const rows = orders.map((order) => [
    order.orderId,
    order.product,
    order.amount,
    order.currency.toUpperCase(),
    order.paidAt,
    FULFILLMENT_LABELS[order.fulfillment.status],
    order.fulfillment.carrier,
    order.fulfillment.trackingNumber,
    order.customer.name,
    order.customer.email,
    order.customer.phone,
    orderAddress(order),
    order.fulfillment.note,
    order.fulfillment.updatedAt,
  ]);

  return `\uFEFF${[header, ...rows]
    .map((row) => row.map((value) => csvCell(value)).join(","))
    .join("\r\n")}`;
}

export function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(href);
}
