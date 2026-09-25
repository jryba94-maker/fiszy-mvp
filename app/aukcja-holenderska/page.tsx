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
        title="Zegar, kwiaty i jedna decyzja."
        lead="Aukcja holenderska to rodzaj aukcji, w której cena produktu zaczyna wysoko i maleje w czasie. Wygrywa pierwsza osoba, która zaakceptuje cenę widoczną w danym momencie. Jej historia zaczęła się od rzeczy, które nie mogły czekać."
        sections={[
          {
            title: "Skąd wzięła się aukcja holenderska?",
            paragraphs: [
              "Ten sposób sprzedaży stał się znakiem rozpoznawczym niderlandzkich rynków, na których liczyły się tempo i świeżość. Kwiaty, rośliny, owoce, warzywa i ryby nie są towarami, które można bez końca trzymać w magazynie. Każda godzina mogła oznaczać niższą jakość, niższą wartość i większą stratę.",
              "Dlatego potrzebny był mechanizm, który pozwalał sprzedać partię szybko, bez długiego podbijania ceny. Cena zaczynała wysoko i spadała na zegarze aukcyjnym, aż ktoś zatrzymał wskazówkę. Jedna decyzja wystarczała, by transakcja doszła do skutku.",
            ],
          },
          {
            title: "Dlaczego właśnie „holenderska”?",
            paragraphs: [
              "Aukcje o malejącej cenie istniały w różnych formach wcześniej. To jednak niderlandzki handel kwiatami i świeżymi produktami sprawił, że model stał się rozpoznawalny na całym świecie jako Dutch auction — aukcja holenderska.",
              "Najbardziej obrazowym symbolem jest zegar aukcyjny z kwiatowych giełd w Holandii. Zamiast aukcjonera wołającego coraz wyższe kwoty, wskazówka przesuwała się ku coraz niższej cenie. Kupujący nie pytał: „ile jeszcze mogę podbić?”. Pytał: „czy zdążę kliknąć, zanim zrobi to ktoś inny?”.",
            ],
          },
          {
            title: "Dlaczego pasowała do roślin i ryb?",
            paragraphs: [
              "W tych branżach czas nie jest dodatkiem do ceny — jest jej częścią. Kwiat ma trafić do kwiaciarni świeży. Ryba ma trafić na rynek, zanim straci wartość. Szybka aukcja zmniejszała czas oczekiwania i pozwalała przeprowadzić wiele transakcji w krótkim czasie.",
              "Mechanizm tworzył też uczciwe napięcie: czekanie dawało szansę na niższą cenę, ale zwiększało ryzyko, że ktoś kupi wcześniej. To nie jest walka o to, kto zapłaci najwięcej. To decyzja, ile warte jest dla Ciebie kilka kolejnych sekund.",
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
              "Fiszy przenosi tę prostą, pierwotną ideę z zegara aukcyjnego na ekran. Każda runda ma określony produkt, czas rozpoczęcia, cenę początkową i zasady spadku ceny. Uczestnik obserwuje cenę na żywo i podejmuje decyzję, zanim zrobi to ktoś inny.",
              "Nie sprzedajemy roślin ani ryb — przenosimy ich najciekawszą zasadę: cena nie stoi w miejscu, a moment decyzji naprawdę ma znaczenie.",
              "Udział może wymagać opłaty wejściowej widocznej przed płatnością. Jeżeli zasady danej rundy to przewidują, pozostali uczestnicy mogą otrzymać ograniczoną czasowo ofertę po zakończeniu aukcji.",
            ],
          },
        ]}
      />
    </>
  );
}
