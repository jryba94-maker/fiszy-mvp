import type { AuctionStatus, PublicAuction } from "./auction-data";

export const BIDDER_STORAGE_KEY = "fiszy-demo-bidder-id";
export const DEVICE_HISTORY_EVENT = "fiszy-device-history-change";

const DEVICE_HISTORY_KEY = "fiszy-device-history-v1";
const MAX_HISTORY_ITEMS = 50;
let volatileBidderId: string | null = null;

export type EntryHistoryState =
  | "checkout"
  | "active"
  | "cancelled"
  | "unconfirmed";

export type PurchaseHistoryState =
  | "checkout"
  | "paid"
  | "lost"
  | "cancelled";

export type DeviceAuctionRecord = {
  key: string;
  auctionId: string;
  runId: string;
  product: string;
  productImageUrl: string | null;
  href: string;
  status: AuctionStatus;
  currentPrice: number;
  regularPrice: number;
  entryFee: number;
  startsAt: string;
  endsAt: string;
  entryState?: EntryHistoryState;
  purchaseState?: PurchaseHistoryState;
  reservedPrice?: number;
  updatedAt: string;
};

function recordKey(auctionId: string, runId: string) {
  return `${auctionId}:${runId}`;
}

function isDeviceRecord(value: unknown): value is DeviceAuctionRecord {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DeviceAuctionRecord>;
  return (
    typeof candidate.key === "string" &&
    typeof candidate.auctionId === "string" &&
    typeof candidate.runId === "string" &&
    typeof candidate.product === "string" &&
    typeof candidate.href === "string" &&
    typeof candidate.status === "string" &&
    typeof candidate.currentPrice === "number" &&
    typeof candidate.updatedAt === "string"
  );
}

export function readDeviceHistory(): DeviceAuctionRecord[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(DEVICE_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isDeviceRecord).slice(0, MAX_HISTORY_ITEMS);
  } catch {
    return [];
  }
}

function writeDeviceHistory(records: DeviceAuctionRecord[]) {
  try {
    window.localStorage.setItem(
      DEVICE_HISTORY_KEY,
      JSON.stringify(records.slice(0, MAX_HISTORY_ITEMS)),
    );
    window.dispatchEvent(new Event(DEVICE_HISTORY_EVENT));
  } catch {
    // The auction flow remains usable even when browser storage is unavailable.
  }
}

export function getBidderId() {
  if (volatileBidderId) return volatileBidderId;

  try {
    const existing = window.localStorage.getItem(BIDDER_STORAGE_KEY);
    if (existing) return existing;
  } catch {
    // Privacy settings can disable storage. The in-memory ID keeps this tab usable.
  }

  const created = window.crypto.randomUUID();
  volatileBidderId = created;
  try {
    window.localStorage.setItem(BIDDER_STORAGE_KEY, created);
  } catch {
    // The ID remains available for the lifetime of this tab.
  }
  return created;
}

export function recordAuctionEvent(
  auction: PublicAuction,
  patch: Partial<
    Pick<
      DeviceAuctionRecord,
      "entryState" | "purchaseState" | "reservedPrice"
    >
  >,
) {
  const records = readDeviceHistory();
  const key = recordKey(auction.auctionId, auction.runId);
  const existing = records.find((record) => record.key === key);
  const base: DeviceAuctionRecord = existing ?? {
    key,
    auctionId: auction.auctionId,
    runId: auction.runId,
    product: auction.product,
    productImageUrl: auction.productImageUrl,
    href: `/aukcje/${encodeURIComponent(auction.auctionId)}`,
    status: auction.status,
    currentPrice: auction.currentPrice,
    regularPrice: auction.regularPrice,
    entryFee: auction.entryFee,
    startsAt: auction.startsAt,
    endsAt: auction.endsAt,
    updatedAt: new Date().toISOString(),
  };
  const next: DeviceAuctionRecord = {
    ...base,
    ...patch,
    product: auction.product,
    productImageUrl: auction.productImageUrl,
    status: auction.status,
    currentPrice: auction.currentPrice,
    regularPrice: auction.regularPrice,
    entryFee: auction.entryFee,
    startsAt: auction.startsAt,
    endsAt: auction.endsAt,
    updatedAt: new Date().toISOString(),
  };

  writeDeviceHistory([next, ...records.filter((record) => record.key !== key)]);
  return next;
}

export function refreshRecordedAuction(auction: PublicAuction) {
  const records = readDeviceHistory();
  const key = recordKey(auction.auctionId, auction.runId);
  const existing = records.find((record) => record.key === key);
  if (!existing) return;

  recordAuctionEvent(auction, {
    entryState: existing.entryState,
    purchaseState: existing.purchaseState,
    reservedPrice: existing.reservedPrice,
  });
}

export function latestPendingReturn(kind: "payment" | "purchase") {
  return readDeviceHistory()
    .filter((record) =>
      kind === "payment"
        ? record.entryState === "checkout"
        : record.purchaseState === "checkout",
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}
