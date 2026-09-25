import type { Metadata } from "next";
import { InfoPage } from "../components/public/InfoPage";
import { serializeJsonLd } from "../../lib/seo";
import { absoluteSiteUrl } from "../../lib/site";

export const metadata: Metadata = {
  title: "Aukcja holenderska a zwykła licytacja — różnice",
  description:
    "W zwykłej licytacji cena rośnie, a w aukcji holenderskiej spada. Zobacz, kto wygrywa i czym różni się decyzja zakupu.",
  alternates: { canonical: "/aukcja-holenderska-a-zwykla-licytacja" },
};

export default function AuctionComparisonPage() {
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: "Aukcja holenderska a zwykła licytacja — różnice",
    description: metadata.description,
    mainEntityOfPage: absoluteSiteUrl("/aukcja-holenderska-a-zwykla-licytacja"),
    publisher: { "@type": "Organization", name: "Fiszy", url: absoluteSiteUrl("/") },
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData) }} />
      <InfoPage
        eyebrow="Porównanie modeli aukcyjnych"
        title="Ta sama emocja. Zupełnie inny ruch ceny."
        lead="Zwykła licytacja i aukcja holenderska mają wspólny finał: jedna osoba kupuje przedmiot. Różni je jednak wszystko, co dzieje się po drodze — przede wszystkim kierunek ceny i rodzaj decyzji uczestnika."
        sections={[
          {
            title: "W zwykłej licytacji cena rośnie",
            paragraphs: [
              "Klasyczna licytacja zaczyna się od ceny wywoławczej. Kolejne osoby składają wyższe oferty, więc cena idzie w górę. Wygrywa ten, kto na końcu zaproponuje najwięcej.",
              "To model oparty na podbijaniu stawki. Patrzysz na innych, odpowiadasz na ich ruchy i decydujesz, czy chcesz zapłacić jeszcze więcej.",
            ],
          },
          {
            title: "W aukcji holenderskiej cena spada",
            paragraphs: [
              "Tutaj produkt zaczyna od wyższej ceny, która obniża się w czasie według jasnych zasad rundy. Nie składasz oferty wyższej od poprzedniej. Akceptujesz cenę, która właśnie jest na ekranie.",
              "Wygrywa nie najwyższa kwota, lecz pierwsza poprawnie zapisana decyzja zakupu. Dlatego pytanie brzmi nie: „ile dam?”, tylko: „czy czekam jeszcze chwilę?”.",
            ],
          },
          {
            title: "Co ryzykuje uczestnik?",
            bullets: [
              "W zwykłej licytacji ryzykujesz, że zapłacisz więcej, niż planowałeś.",
              "W aukcji holenderskiej ryzykujesz, że ktoś kupi produkt, zanim cena spadnie do Twojego poziomu.",
              "W obu modelach wynik zależy od decyzji, ale presja działa w przeciwną stronę.",
            ],
          },
          {
            title: "Dlaczego Fiszy wybiera spadającą cenę?",
            paragraphs: [
              "Chcemy przywrócić zakupy, w których moment naprawdę ma znaczenie. Aukcja holenderska nie premiuje osoby z najwyższym limitem. Daje każdemu ten sam zegar, tę samą cenę i tę samą chwilę do decyzji.",
              "Nie chodzi o to, by wygrać z kimś większym portfelem. Chodzi o własną ocenę: czy obecna cena jest już moja?",
            ],
            links: [
              { href: "/aukcja-holenderska", label: "Poznaj historię aukcji holenderskiej" },
              { href: "/cena-spada-w-aukcji-holenderskiej", label: "Dlaczego cena spada?" },
            ],
          },
        ]}
      />
    </>
  );
}
