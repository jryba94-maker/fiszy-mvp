import type { Metadata } from "next";
import { AuctionExperience } from "./AuctionExperience";

export const metadata: Metadata = {
  title: "Aukcja",
  description: "Obserwuj spadającą cenę i wybierz swój moment.",
};

export default async function AuctionPage({
  params,
}: {
  params: Promise<{ auctionId: string }>;
}) {
  const { auctionId } = await params;
  return <AuctionExperience auctionId={auctionId} />;
}
