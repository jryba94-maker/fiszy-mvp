import Link from "next/link";
import { auctionCategoryLabel, type PublicAuction } from "./auction-data";
import { SafeAuctionImage } from "./SafeAuctionImage";
import { StatusBadge } from "./StatusBadge";
import { WatchButton } from "./WatchButton";
import styles from "./public.module.css";

function startLabel(auction: PublicAuction) {
  if (auction.status === "waiting") {
    return `Start ${new Intl.DateTimeFormat("pl-PL", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
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
  return (
    <article className={styles.auctionCard}>
      <SafeAuctionImage
        src={auction.productImageUrl}
        alt={auction.product}
        sizes="(max-width: 760px) 100vw, (max-width: 1100px) 50vw, 33vw"
        frameClassName={styles.cardImage}
      />
      <div className={styles.cardBody}>
        <div className={styles.cardTopline}>
          <div className={styles.cardBadges}>
            <StatusBadge status={auction.status} />
            <span className={styles.categoryBadge}>{auctionCategoryLabel(auction.category)}</span>
          </div>
          <span className={styles.duration}>{auction.durationMinutes} min</span>
        </div>
        <h3 className={styles.cardTitle}>{auction.product}</h3>
        <div className={styles.priceRow}>
          <div>
            <span className={styles.priceLabel}>Aktualna cena</span>
            <span className={styles.price}>{auction.currentPrice} zł</span>
          </div>
          <span className={styles.regularPrice}>{auction.regularPrice} zł</span>
        </div>
        <div className={styles.cardMeta}>{startLabel(auction)}</div>
        <div className={styles.cardTools}>
          <WatchButton auctionId={auction.auctionId} watched={watched} busy={watchBusy} onToggle={onWatchToggle} />
          <a
            className={styles.calendarLink}
            href={`/api/auctions/${encodeURIComponent(auction.auctionId)}/calendar`}
            aria-label={`Dodaj start aukcji ${auction.product} do kalendarza`}
          >
            + Kalendarz
          </a>
        </div>
        <Link
          className={styles.cardLink}
          href={`/aukcje/${encodeURIComponent(auction.auctionId)}`}
          aria-label={`Zobacz aukcję: ${auction.product}`}
        >
          <span>Zobacz aukcję</span>
          <span aria-hidden="true">→</span>
        </Link>
      </div>
    </article>
  );
}
