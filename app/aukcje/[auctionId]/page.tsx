import type { Metadata } from "next";
import { readPublicAuction } from "../../../lib/auction-view";
import { AuctionExperience } from "./AuctionExperience";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ auctionId: string }>;
}): Promise<Metadata> {
  const { auctionId } = await params;
  try {
    const auction = await readPublicAuction(auctionId);
    if (!auction) return { title: "Aukcja", robots: { index: false, follow: false } };
    return {
      title: auction.product,
      description: `${auction.product}: cena spada od ${auction.startPrice} zł do ${auction.floorPrice} zł. Wybierz swój moment.`,
      alternates: { canonical: `/aukcje/${encodeURIComponent(auction.auctionId)}` },
      openGraph: {
        type: "website",
        title: `${auction.product} — aukcja Fiszy`,
        description: `Obserwuj cenę od ${auction.startPrice} zł do ${auction.floorPrice} zł.`,
        url: `/aukcje/${encodeURIComponent(auction.auctionId)}`,
      },
    };
  } catch {
    return { title: "Aukcja", description: "Obserwuj spadającą cenę i wybierz swój moment." };
  }
}

export default async function AuctionPage({
  params,
}: {
  params: Promise<{ auctionId: string }>;
}) {
  const { auctionId } = await params;
  return <AuctionExperience auctionId={auctionId} />;
}
