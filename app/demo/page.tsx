import type { Metadata } from "next";
import { DemoAuction } from "./DemoAuction";

export const metadata: Metadata = {
  title: "Demo aukcji — Fiszy",
  description: "Zobacz w 40 sekund, jak działa aukcja holenderska na Fiszy.",
  alternates: { canonical: "/demo" },
  robots: { index: false, follow: true },
};

export default function DemoPage() {
  return <DemoAuction />;
}
