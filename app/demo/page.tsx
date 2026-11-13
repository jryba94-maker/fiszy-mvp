import type { Metadata } from "next";
import { readPublicAuction } from "../../lib/auction-view";
import { ClerkShell } from "../components/auth/ClerkShell";
import { DemoAuction } from "./DemoAuction";

export const metadata: Metadata = {
  title: "Demo aukcji — Fiszy",
  description: "Sprawdź aukcję, kolejkę kupujących i symulację płatności BLIK z własnymi 2 minutami na zapłatę.",
  alternates: { canonical: "/demo" },
  robots: { index: false, follow: true },
};

export const dynamic = "force-dynamic";

export default async function DemoPage() {
  const auction = await readPublicAuction("dc2afb9c-b63b-4811-ba98-94d5b4031362").catch(() => null);
  const target = auction?.status === "waiting" ? auction : null;

  return (
    <ClerkShell>
      <DemoAuction
        initialProduct={target ? {
          id: target.auctionId,
          name: target.product,
          price: target.startPrice,
          image: target.productImageUrl,
        } : undefined}
        auctionHref={target ? `/aukcje/${encodeURIComponent(target.auctionId)}?run=${encodeURIComponent(target.runId)}` : "/"}
        auctionLabel={target ? "Przejdź do aukcji GTA VI" : "Zobacz aukcje Fiszy"}
        auctionDetails={target ? `${new Intl.DateTimeFormat("pl-PL", {
          dateStyle: "short", timeStyle: "short", timeZone: "Europe/Warsaw",
        }).format(new Date(target.startsAt))} · wejście ${target.entryFee} zł` : undefined}
      />
    </ClerkShell>
  );
}
