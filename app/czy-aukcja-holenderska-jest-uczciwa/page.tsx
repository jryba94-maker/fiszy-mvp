import type { Metadata } from "next";
import { InfoPage } from "../components/public/InfoPage";
import { serializeJsonLd } from "../../lib/seo";
import { absoluteSiteUrl } from "../../lib/site";

export const metadata: Metadata = {
  title: "Czy aukcja holenderska jest uczciwa?",
  description:
    "Aukcja holenderska może być uczciwa, jeśli jej zasady, cena, tempo spadku i rozstrzygnięcie zwycięzcy są jasne. Sprawdź, co to oznacza w praktyce.",
  alternates: { canonical: "/czy-aukcja-holenderska-jest-uczciwa" },
};

export default function FairAuctionPage() {
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "Czy aukcja holenderska jest uczciwa?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Tak, jeśli zasady rundy są podane przed startem, wszyscy widzą tę samą cenę, a zwycięstwo jest rozstrzygane według jasno opisanej kolejności poprawnie zapisanych decyzji zakupu.",
        },
      },
      {
        "@type": "Question",
        name: "Czy najniższa cena zawsze wygrywa?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Nie. Wygrywa pierwsza osoba, która zaakceptuje aktualną cenę. Czekanie może obniżyć cenę, ale zwiększa ryzyko, że produkt kupi ktoś inny.",
        },
      },
    ],
    url: absoluteSiteUrl("/czy-aukcja-holenderska-jest-uczciwa"),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData) }} />
      <InfoPage
        eyebrow="Zasady i zaufanie"
        title="Emocje tak. Zasady bez niedomówień."
        lead="Aukcja holenderska jest uczciwa nie dlatego, że każdy kończy z tym samym wynikiem. Jest uczciwa wtedy, gdy każdy przed startem zna reguły, widzi te same informacje i wie, co dokładnie rozstrzyga zakup."
        sections={[
          {
            title: "Uczciwość zaczyna się przed aukcją",
            paragraphs: [
              "Uczestnik powinien znać produkt, cenę początkową, sposób oraz tempo obniżania ceny, czas startu i warunki udziału. Jeżeli aukcja ma opłatę wejściową, musi być widoczna przed płatnością. Jeżeli po zakończeniu przewidziana jest oferta dla pozostałych osób, jej zasady również nie mogą być niespodzianką.",
              "Dzięki temu nikt nie kupuje w ciemno. Każda osoba podejmuje własną decyzję na podstawie tych samych informacji.",
            ],
          },
          {
            title: "Ta sama cena dla wszystkich",
            paragraphs: [
              "W danej chwili uczestnicy obserwują tę samą aktualną cenę. Różnica nie polega na dostępie do lepszej stawki, lecz na tym, kto zdecyduje się ją zaakceptować.",
              "O zwycięstwie nie powinna decydować interpretacja aukcjonera. W Fiszy liczy się pierwsza poprawnie zapisana decyzja zakupu, zgodnie z regulaminem i zasadami konkretnej rundy.",
            ],
          },
          {
            title: "Co jest uczciwe, a co nie?",
            bullets: [
              "Uczciwe: jawne zasady, aktualna cena widoczna przed decyzją i jasne rozstrzygnięcie zwycięzcy.",
              "Nieuczciwe: zmiana zasad w trakcie, ukryte koszty lub niejasne warunki udziału.",
              "Uczciwe: możliwość zrezygnowania z udziału, zanim opłacisz wejście do rundy.",
            ],
          },
          {
            title: "W Fiszy najpierw czytasz, potem decydujesz",
            paragraphs: [
              "Fiszy nie obiecuje, że każdy kupi. Obiecuje czytelny mechanizm: cena spada, moment zakupu należy do uczestnika, a zasady są dostępne przed rozpoczęciem aukcji.",
            ],
            links: [
              { href: "/zasady-aukcji", label: "Przeczytaj zasady aukcji" },
              { href: "/jak-kupowac-na-aukcji-holenderskiej", label: "Jak podejść do pierwszej aukcji" },
            ],
          },
        ]}
      />
    </>
  );
}
