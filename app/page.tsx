import type { Metadata } from "next";
import { WaitlistLanding } from "./components/landing/WaitlistLanding";

export const metadata: Metadata = {
  title: "Coś zacznie spadać",
  description: "Zostaw e-mail i dowiedz się jako pierwszy, kiedy wystartuje pierwsza aukcja Fiszy.",
  alternates: { canonical: "/" },
};

export default function HomePage() {
  return <WaitlistLanding />;
}
