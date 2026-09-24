import type { Metadata } from "next";
import { InfoPage } from "../components/public/InfoPage";

export const metadata: Metadata = {
  title: "Jak działa Fiszy — aukcja holenderska",
  description:
    "Cena w Fiszy zaczyna wysoko i spada w czasie. Obserwujesz ją i kupujesz wtedy, gdy aktualna cena Ci odpowiada. Pierwsza decyzja kończy aukcję.",
  alternates: { canonical: "/jak-to-dziala" },
};

export default function HowItWorksPage() {
  return (
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
          title: "4. Pierwsza decyzja kończy aukcję",
          paragraphs: [
            "Pierwsza poprawnie zapisana decyzja zakupu wygrywa. Cena widoczna w chwili zwycięskiego kliknięcia staje się ceną zakupu.",
          ],
        },
      ]}
    />
  );
}
