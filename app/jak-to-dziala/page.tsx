import type { Metadata } from "next";
import { serializeJsonLd } from "../../lib/seo";
import { absoluteSiteUrl } from "../../lib/site";
import { InfoPage } from "../components/public/InfoPage";

export const metadata: Metadata = {
  title: "Jak działa Fiszy — aukcja holenderska",
  description:
    "Cena w Fiszy zaczyna wysoko i spada w czasie. Obserwujesz ją i kupujesz wtedy, gdy aktualna cena Ci odpowiada. Kliknięcie zapisuje miejsce w kolejce. Aukcję kończy potwierdzona płatność.",
  alternates: { canonical: "/jak-to-dziala" },
};

export default function HowItWorksPage() {
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: "Jak działa aukcja holenderska w Fiszy",
    description:
      "Cena produktu spada w czasie. Kliknięcie zapisuje cenę i pozycję w kolejce; produkt kupuje osoba, której płatność zostanie potwierdzona zgodnie z kolejnością.",
    url: absoluteSiteUrl("/jak-to-dziala"),
    step: [
      "Aukcja startuje od ceny początkowej.",
      "Uczestnicy obserwują malejącą cenę.",
      "Uczestnik wybiera moment zakupu.",
      "Kliknięcie zapisuje kolejność i cenę; potwierdzona płatność kończy aukcję.",
    ].map((text, index) => ({
      "@type": "HowToStep",
      position: index + 1,
      text,
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData) }}
      />
      <InfoPage
        eyebrow="Jak to działa"
        title="Cena spada. Ty wybierasz moment."
        lead="Fiszy to platforma zakupowa oparta na aukcjach holenderskich. Nie licytujesz ceny w górę — obserwujesz, jak cena produktu maleje, i decydujesz, kiedy kupić."
        sections={[
        {
          title: "1. Aukcja startuje od ceny początkowej",
          paragraphs: [
            "Każda aukcja ma określony produkt, czas startu i cenę początkową. Po rozpoczęciu cena zaczyna spadać zgodnie z zasadami danej rundy.",
          ],
        },
        {
          title: "2. Obserwujesz malejącą cenę",
          paragraphs: [
            "Im dłużej czekasz, tym niższa może być cena. Jednocześnie inni uczestnicy widzą tę samą aukcję i również mogą zdecydować się na zakup.",
          ],
        },
        {
          title: "3. Klikasz, kiedy cena Ci odpowiada",
          paragraphs: [
            "Nie podbijasz stawki. Podejmujesz jedną decyzję: kupić teraz czy poczekać na niższą cenę.",
          ],
        },
        {
          title: "4. Potwierdzona płatność kończy aukcję",
          paragraphs: [
            "Pierwsza osoba ma 2 minuty na opłacenie produktu. Po upływie czasu zamykamy transakcję u operatora. Rezerwacja trwa do potwierdzenia zamknięcia lub skutecznej płatności. W razie potwierdzonego niepowodzenia do płatności przechodzi następna osoba. Każda osoba zachowuje cenę zapisaną przy swoim kliknięciu.",
          ],
        },
        ]}
      />
    </>
  );
}
