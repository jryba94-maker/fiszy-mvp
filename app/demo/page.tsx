import type { Metadata } from "next";
import { DemoAuction } from "./DemoAuction";

export const metadata: Metadata = {
  title: "Demo aukcji — Fiszy",
  description: "Sprawdź aukcję, kolejkę kupujących i symulację płatności BLIK z własnymi 2 minutami na zapłatę.",
  alternates: { canonical: "/demo" },
  robots: { index: false, follow: true },
};

export default function DemoPage() {
  return <DemoAuction />;
}
