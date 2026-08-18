import type { Metadata } from "next";
import { LegalPage } from "../components/legal/LegalPage";
export const metadata: Metadata = { title: "Zasady aukcji", description: "Jak działają aukcje Fiszy." };
export default function Page() { return <LegalPage eyebrow="Mechanika" title="Zasady aukcji" lead="Czytelny opis wejścia, spadającej ceny, zwycięstwa i finalizacji zamówienia." sections={[
  { title: "Przed startem", bullets: ["Każda runda ma własny czas startu, cenę początkową, cenę minimalną i czas trwania.", "Wejście można opłacić od publikacji zaplanowanej rundy aż do chwili jej rozpoczęcia. Po starcie nie można już dołączyć.", "Wejście dotyczy jednej konkretnej rundy i nie przechodzi automatycznie na następną.", "Opłata za wejście jest pokazywana przed przejściem do operatora płatności."] },
  { title: "Gdy cena spada", paragraphs: ["Po starcie cena spada skokowo o kwotę opłaty za wejście. Skoki są równomiernie rozłożone na cały czas rundy, a ostatnią ceną jest zawsze 1 zł. Zegar urządzenia użytkownika ma charakter informacyjny; rozstrzygający jest stan zapisany po stronie serwera."] },
  { title: "Zwycięskie kliknięcie", bullets: ["Serwer przyjmuje oczekiwaną cenę widoczną w chwili kliknięcia i odrzuca nieaktualną wartość.", "Atomowo może powstać tylko jeden zwycięzca rundy.", "Pozostali uczestnicy otrzymują informację, że ktoś był pierwszy."] },
  { title: "Czas na zapłatę", paragraphs: ["Zwycięzca otrzymuje ograniczony czas na zakończenie płatności. Po jego upływie rezerwacja może zostać zwolniona zgodnie z komunikatem pokazanym przy zakupie."] },
  { title: "Zakłócenia i unieważnienie", paragraphs: ["Przy potwierdzonym błędzie systemowym, niezgodności danych lub niedostępności operatora płatności runda może zostać wstrzymana lub unieważniona. Każdy przypadek wymaga śladu audytowego i rozliczenia pobranych środków."] },
]} />; }
