import type { Metadata } from "next";
import { AuctionCatalog } from "../components/public/AuctionCatalog";

export const metadata: Metadata = {
  title: "Aukcje Fiszy",
  description: "Zobacz aukcje Fiszy i sprawdź terminy. Cena spada — Ty wybierasz moment zakupu.",
  alternates: { canonical: "/aukcje" },
};

export default function AuctionsPage() {
  return <AuctionCatalog />;
}
