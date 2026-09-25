import type { Metadata } from "next";
import { InfoPage } from "../components/public/InfoPage";
import { serializeJsonLd } from "../../lib/seo";
import { absoluteSiteUrl } from "../../lib/site";

export const metadata: Metadata = {
  title: "Jak kupować na aukcji holenderskiej?",
  description:
    "Jak podejść do pierwszej aukcji holenderskiej: poznaj zasady, ustal swoją cenę i zdecyduj, zanim produkt kupi ktoś inny.",
  alternates: { canonical: "/jak-kupowac-na-aukcji-holenderskiej" },
};

export default function BuyingGuidePage() {
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: "Jak kupować na aukcji holenderskiej",
    description: metadata.description,
    url: absoluteSiteUrl("/jak-kupowac-na-aukcji-holenderskiej"),
    step: [
      "Poznaj produkt i zasady konkretnej rundy.",
      "Ustal cenę, przy której zakup jest dla Ciebie dobry.",
      "Obserwuj spadającą cenę w czasie aukcji.",
      "Podejmij decyzję, zanim zrobi to ktoś inny.",
    ].map((text, index) => ({ "@type": "HowToStep", position: index + 1, text })),
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData) }} />
      <InfoPage
        eyebrow="Pierwsza aukcja"
        title="Nie szukaj idealnego momentu. Ustal swój."
        lead="Aukcja holenderska nie wymaga tajnej strategii. Wymaga jasnej decyzji: za jaką cenę produkt jest dla Ciebie wart natychmiastowego zakupu i czy chcesz ryzykować dalsze czekanie."
        sections={[
          {
            title: "1. Zacznij od produktu i zasad rundy",
            paragraphs: [
              "Zanim aukcja ruszy, sprawdź, co dokładnie kupujesz oraz jak wygląda konkretna runda: cenę początkową, sposób spadku ceny, warunki udziału i zasady płatności. To ważniejsze niż próba przewidzenia ruchu innych osób.",
            ],
          },
          {
            title: "2. Ustal cenę, a nie marzenie o najniższej cenie",
            paragraphs: [
              "Pomyśl: „przy tej cenie będę zadowolony, nawet jeśli za chwilę mogłaby spaść jeszcze niżej”. To Twój punkt decyzji. Najniższa cena jest możliwa tylko wtedy, gdy nikt nie kupi wcześniej — nie jest obietnicą aukcji.",
            ],
          },
          {
            title: "3. Obserwuj cenę, nie tłum",
            paragraphs: [
              "Nie musisz zgadywać, ile osób patrzy na aukcję ani reagować nerwowo na każdą sekundę. Masz własną granicę. Gdy aktualna cena ją osiągnie, wybierasz: kupuję albo czekam dalej, świadomie zwiększając ryzyko.",
            ],
          },
          {
            title: "4. Po decyzji akceptujesz wynik",
            paragraphs: [
              "Jeśli kupisz — cena z chwili zwycięskiej decyzji staje się ceną zakupu. Jeśli ktoś kupi wcześniej — to znaczy, że jego granica była wyżej albo jego decyzja nastąpiła wcześniej. To naturalna część modelu, a nie błąd systemu.",
            ],
          },
          {
            title: "Najkrótsza strategia na Fiszy",
            bullets: [
              "Przeczytaj zasady konkretnej aukcji.",
              "Ustal cenę, przy której nie będziesz żałować zakupu.",
              "Nie czekaj tylko dlatego, że cena może spaść jeszcze o złotówkę.",
              "Decyduj po swojemu — zanim zdecyduje ktoś inny.",
            ],
            links: [
              { href: "/jak-to-dziala", label: "Zobacz mechanizm Fiszy" },
              { href: "/aukcje", label: "Zobacz dostępne aukcje" },
            ],
          },
        ]}
      />
    </>
  );
}
