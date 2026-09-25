import type { Metadata } from "next";
import { serializeJsonLd } from "../../lib/seo";
import { absoluteSiteUrl } from "../../lib/site";
import { InfoPage } from "../components/public/InfoPage";

export const metadata: Metadata = {
  title: "Aukcja holenderska — co to jest i jak działa",
  description:
    "Aukcja holenderska zaczyna się od wyższej ceny, która spada w czasie. Wygrywa pierwsza osoba, która zaakceptuje aktualną cenę.",
  alternates: { canonical: "/aukcja-holenderska" },
};

export default function DutchAuctionPage() {
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "DefinedTerm",
    name: "Aukcja holenderska",
    alternateName: ["aukcja ze spadającą ceną", "aukcja z malejącą ceną"],
    description:
      "Rodzaj aukcji, w której cena zaczyna wysoko i spada w czasie, aż pierwszy uczestnik zaakceptuje aktualną cenę.",
    url: absoluteSiteUrl("/aukcja-holenderska"),
    inDefinedTermSet: {
      "@type": "DefinedTermSet",
      name: "Pojęcia Fiszy",
      url: absoluteSiteUrl("/jak-to-dziala"),
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData) }}
      />
      <InfoPage
        eyebrow="Aukcja holenderska"
        title="Cena nie rośnie. Cena spada."
        lead="Aukcja holenderska to rodzaj aukcji, w której cena produktu zaczyna wysoko i maleje w czasie. Wygrywa pierwsza osoba, która zaakceptuje cenę widoczną w danym momencie."
        sections={[
          {
            title: "Na czym polega aukcja holenderska?",
            paragraphs: [
              "W klasycznej licytacji kolejne oferty podnoszą cenę. W aukcji holenderskiej mechanizm działa odwrotnie: cena jest stopniowo obniżana, dopóki jeden z uczestników nie zdecyduje się na zakup.",
              "Uczestnicy nie wpisują własnych stawek. Każdy widzi aktualną cenę i wybiera, czy kupić teraz, czy zaryzykować czekanie na kolejny spadek.",
            ],
          },
          {
            title: "Kto wygrywa?",
            paragraphs: [
              "Wygrywa pierwsza osoba, której decyzja zakupu zostanie poprawnie zapisana. Aukcja kończy się w tym momencie, a zaakceptowana cena staje się ceną zakupu.",
            ],
          },
          {
            title: "Aukcja holenderska a zwykła licytacja",
            bullets: [
              "W zwykłej licytacji cena rośnie; w aukcji holenderskiej maleje.",
              "W zwykłej licytacji wygrywa najwyższa oferta; tutaj wygrywa pierwsza akceptacja aktualnej ceny.",
              "Nie podbijasz stawki; wybierasz moment zakupu.",
            ],
          },
          {
            title: "Jak aukcje holenderskie działają w Fiszy?",
            paragraphs: [
              "Każda runda ma określony produkt, czas rozpoczęcia, cenę początkową i zasady spadku ceny. Uczestnik obserwuje cenę na żywo i podejmuje decyzję, zanim zrobi to ktoś inny.",
              "Udział może wymagać opłaty wejściowej widocznej przed płatnością. Jeżeli zasady danej rundy to przewidują, pozostali uczestnicy mogą otrzymać ograniczoną czasowo ofertę po zakończeniu aukcji.",
            ],
          },
        ]}
      />
    </>
  );
}
