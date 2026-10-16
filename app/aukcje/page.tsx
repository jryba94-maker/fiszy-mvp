import type { Metadata } from "next";
import { AuctionCatalog } from "../components/public/AuctionCatalog";

export const metadata: Metadata = {
  title: "Pierwsza aukcja Fiszy",
  description: "Dołącz do pierwszej aukcji Fiszy. Cena spada — Ty wybierasz moment zakupu.",
  alternates: { canonical: "/aukcje" },
};

export default function AuctionsPage() {
  return <AuctionCatalog />;
}
