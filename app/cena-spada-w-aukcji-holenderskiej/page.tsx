import type { Metadata } from "next";
import { InfoPage } from "../components/public/InfoPage";
import { serializeJsonLd } from "../../lib/seo";
import { absoluteSiteUrl } from "../../lib/site";

export const metadata: Metadata = {
  title: "Dlaczego cena spada w aukcji holenderskiej?",
  description:
    "Cena w aukcji holenderskiej nie jest przypadkiem. Sprawdź, co oznacza spadek ceny, czym jest cena akceptowalna i dlaczego moment zakupu ma znaczenie.",
  alternates: { canonical: "/cena-spada-w-aukcji-holenderskiej" },
};

export default function FallingPricePage() {
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: "Dlaczego cena spada w aukcji holenderskiej?",
    description: metadata.description,
    mainEntityOfPage: absoluteSiteUrl("/cena-spada-w-aukcji-holenderskiej"),
    publisher: { "@type": "Organization", name: "Fiszy", url: absoluteSiteUrl("/") },
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData) }} />
      <InfoPage
        eyebrow="Cena w ruchu"
        title="Cena nie jest tłem. Jest decyzją."
        lead="W aukcji holenderskiej cena nie spada po to, by stworzyć dekorację. To prosty sposób, aby kupujący sam określił, kiedy oferta staje się dla niego wystarczająco dobra — zanim zrobi to ktoś inny."
        sections={[
          {
            title: "Spadek ceny zamienia zakup w wybór",
            paragraphs: [
              "W sklepie cena zwykle stoi w miejscu. Możesz wrócić za godzinę, jutro albo za tydzień i nadal podjąć tę samą decyzję. W aukcji holenderskiej czas zmienia warunki: każda kolejna chwila może oznaczać niższą cenę, ale też mniejszą szansę na dostępność produktu.",
              "Nie jest to ukryty mechanizm. Cena początkowa, tempo spadku i zasady rundy powinny być znane uczestnikowi przed decyzją. Dzięki temu ryzyko nie polega na zgadywaniu zasad, tylko na ocenie własnego momentu.",
            ],
          },
          {
            title: "Czym jest cena akceptowalna?",
            paragraphs: [
              "To nie musi być najniższa możliwa cena. Cena akceptowalna to taka, przy której wolisz mieć pewność zakupu niż czekać na kolejną obniżkę.",
              "Dla jednej osoby będzie to wysoka cena i szybkie kliknięcie. Dla innej niższa cena oraz większe ryzyko. Obie decyzje są logiczne, jeśli wynikają z tego samego, czytelnego mechanizmu.",
            ],
          },
          {
            title: "Czego cena spadająca nie oznacza",
            bullets: [
              "Nie oznacza, że cena będzie spadać bez końca.",
              "Nie oznacza, że najcierpliwsza osoba zawsze kupi najtaniej.",
              "Nie oznacza ukrytej promocji — warunki konkretnej rundy są częścią jej zasad.",
            ],
          },
          {
            title: "Jak działa to w Fiszy?",
            paragraphs: [
              "W Fiszy uczestnicy widzą tę samą aktualną cenę. Kiedy ktoś podejmie zwycięską decyzję, aukcja się kończy, a widoczna wtedy cena staje się ceną zakupu. Najważniejsza jest więc nie szybkość odświeżania strony, lecz moment poprawnie zapisanej decyzji zgodnie z zasadami rundy.",
            ],
            links: [
              { href: "/jak-to-dziala", label: "Jak działa Fiszy krok po kroku" },
              { href: "/czy-aukcja-holenderska-jest-uczciwa", label: "Czy ten model jest uczciwy?" },
            ],
          },
        ]}
      />
    </>
  );
}
