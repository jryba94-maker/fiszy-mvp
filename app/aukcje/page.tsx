import type { Metadata } from "next";
import { AuctionCatalog } from "../components/public/AuctionCatalog";

export const metadata: Metadata = {
  title: "Aktualne aukcje",
  description: "Zobacz aktualne aukcje Fiszy z malejącą ceną.",
  alternates: { canonical: "/aukcje" },
};

export default function AuctionsPage() {
  return <AuctionCatalog />;
}
