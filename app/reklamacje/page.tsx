import type { Metadata } from "next";
import { LegalPage } from "../components/legal/LegalPage";
export const metadata: Metadata = { title: "Reklamacje i zwroty", description: "Proces reklamacji i zwrotów w Fiszy." };
export default function Page() { return <LegalPage eyebrow="Obsługa posprzedażowa" title="Reklamacje i zwroty" lead="Jedno miejsce na problem z aukcją, płatnością, produktem lub dostawą." sections={[
  { title: "Jak zgłosić sprawę", bullets: ["Zaloguj się i przejdź do Moje Fiszy → Pomoc i reklamacje.", "Wybierz rodzaj sprawy, podaj numer zamówienia i opisz oczekiwane rozwiązanie.", "Zachowaj numer zgłoszenia; status i odpowiedź pojawią się na koncie."] },
  { title: "Reklamacja produktu", paragraphs: ["Opisz wadę, datę jej zauważenia i dołącz informacje potrzebne do identyfikacji zamówienia. Obsługa wskaże sposób przekazania produktu oraz dalsze terminy."] },
  { title: "Odstąpienie konsumenta", paragraphs: ["Prawo odstąpienia, jego termin i wyjątki zależą od charakteru produktu i umowy. Docelowy formularz odstąpienia oraz adres zwrotu muszą zostać uzupełnione po wskazaniu danych sprzedawcy i procesu logistycznego."] },
  { title: "Płatność lub opłata za wejście", paragraphs: ["Nie usuwamy zapisów, aby ukryć transakcję. Każdy zwrot jest uzgadniany z referencją operatora płatności, rundą i kontem, a wynik pozostaje w audycie."] },
  { title: "Terminy", paragraphs: ["Portal zapisuje datę zgłoszenia i zmianę statusu. Obowiązujące terminy odpowiedzi wynikające z prawa muszą zostać potwierdzone w finalnym regulaminie przez doradcę prawnego."] },
]} />; }
