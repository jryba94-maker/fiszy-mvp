import type { Metadata } from "next";
import { AuctionCatalog } from "./components/public/AuctionCatalog";

export const metadata: Metadata = {
  title: "Fiszy — aukcje, w których cena spada",
  description:
    "Fiszy to platforma zakupowa oparta na aukcjach holenderskich: cena produktu spada w czasie, a pierwsza osoba, która kupi po aktualnej cenie, wygrywa aukcję.",
  alternates: { canonical: "/" },
};

export default function HomePage() {
  return <AuctionCatalog />;
}
