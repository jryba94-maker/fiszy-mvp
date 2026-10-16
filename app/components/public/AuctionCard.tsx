import Link from "next/link";
import { type PublicAuction } from "./auction-data";
import { SafeAuctionImage } from "./SafeAuctionImage";
import { WatchButton } from "./WatchButton";
import styles from "./public.module.css";

function startLabel(auction: PublicAuction) {
  if (auction.status === "waiting") {
    return `Start ${new Intl.DateTimeFormat("pl-PL", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Warsaw",
    }).format(new Date(auction.startsAt))}`;
  }
  if (auction.status === "live") return "Cena spada na żywo";
  if (auction.status === "payment_pending") return "Zwycięzca kończy płatność";
  if (auction.status === "sold") return "Produkt ma już właściciela";
  return "Ta aukcja dobiegła końca";
}

export function AuctionCard({ auction, watched = false, watchBusy = false, onWatchToggle = () => undefined }: {
  auction: PublicAuction;
  watched?: boolean;
  watchBusy?: boolean;
  onWatchToggle?: (auctionId: string, watched: boolean) => void;
}) {
  const titleId = `auction-card-${auction.auctionId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const displayedPriceLabel = auction.status === "waiting" ? "Cena startowa" : "Aktualna cena";
  return (
    <article className={`${styles.auctionCard} ${styles.featureCard}`} aria-labelledby={titleId}>
      <SafeAuctionImage
        src={auction.productImageUrl}
        alt={auction.product}
        sizes="(max-width: 760px) 100vw, 520px"
        frameClassName={styles.cardImage}
      />
      <div className={styles.cardBody}>
        <p className={styles.featureStatus}>{auction.status === "waiting" ? "Nadchodzi pierwsza aukcja" : auction.status === "live" ? "Aukcja trwa" : "Pierwsza aukcja Fiszy"}</p>
        <h3 className={styles.cardTitle} id={titleId}>{auction.product}</h3>
        <div className={styles.cardMeta}>{startLabel(auction)} · {auction.durationMinutes} min</div>
        <div className={styles.priceRow}>
          <div>
            <span className={styles.priceLabel}>{displayedPriceLabel}</span>
            <span className={styles.price}>{auction.currentPrice} zł</span>
          </div>
          {auction.regularPrice > auction.currentPrice ? <span className={styles.regularPrice}>{auction.regularPrice} zł</span> : null}
        </div>
        <Link
          className={styles.cardLink}
          href={`/aukcje/${encodeURIComponent(auction.auctionId)}`}
          aria-label={`Zobacz aukcję: ${auction.product}`}
        >
          <span>Zobacz aukcję</span>
          <span aria-hidden="true">→</span>
        </Link>
        <div className={styles.cardTools}>
          <WatchButton auctionId={auction.auctionId} watched={watched} busy={watchBusy} onToggle={onWatchToggle} />
          {auction.status === "waiting" ? (
            <a
              className={styles.calendarLink}
              href={`/api/auctions/${encodeURIComponent(auction.auctionId)}/calendar`}
              aria-label={`Dodaj start aukcji ${auction.product} do kalendarza`}
            >
              + Kalendarz
            </a>
          ) : null}
        </div>
      </div>
    </article>
  );
}
