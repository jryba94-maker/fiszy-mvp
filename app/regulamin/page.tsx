import type { Metadata } from "next";
import { LegalPage } from "../components/legal/LegalPage";
export const metadata: Metadata = { title: "Regulamin", description: "Roboczy regulamin portalu Fiszy." };
export default function Page() { return <LegalPage eyebrow="Dokumenty" title="Regulamin portalu" lead="Najważniejsze zasady konta, korzystania z serwisu, płatności i odpowiedzialności stron." sections={[
  { title: "1. Operator i zakres usługi", paragraphs: ["Fiszy jest portalem aukcji z malejącą ceną. Dane identyfikujące operatora, adres, NIP, kontakt i organ rejestrowy muszą zostać uzupełnione przed publiczną sprzedażą.", "Korzystanie z konta wymaga zaakceptowania regulaminu i polityki prywatności w wersji obowiązującej w chwili czynności."] },
  { title: "2. Konto użytkownika", bullets: ["Konto można utworzyć adresem e-mail lub obsługiwanym dostawcą logowania.", "Użytkownik odpowiada za bezpieczeństwo swojego sposobu logowania i prawdziwość danych dostawy.", "Jedna osoba nie może używać wielu kont do obchodzenia limitów lub wpływania na wynik aukcji."] },
  { title: "3. Aukcje i opłaty", paragraphs: ["Szczegółowe reguły wejścia, spadku ceny, zwycięskiego kliknięcia i czasu na zapłatę opisują Zasady aukcji. Przed potwierdzeniem płatności użytkownik widzi cenę, opłatę i wymagane działanie."], bullets: ["Cena i czas są ustalane przez serwer.", "Pierwsze poprawnie zapisane kliknięcie wygrywa.", "Nieudana lub anulowana płatność nie tworzy opłaconego zamówienia."] },
  { title: "4. Zamówienie i dostawa", paragraphs: ["Po potwierdzeniu zapłaty powstaje zamówienie. Status realizacji, numer przesyłki i kontakt z obsługą są dostępne w Moje Fiszy."] },
  { title: "5. Reklamacje, odstąpienie i zwroty", paragraphs: ["Uprawnienia konsumenta nie są ograniczane przez mechanikę aukcji. Procedura zależy od rodzaju produktu i podstawy zgłoszenia; szczegóły zawiera strona Reklamacje."] },
  { title: "6. Niedozwolone działania", bullets: ["automatyczne klikanie, boty i próby przeciążenia", "podszywanie się pod inną osobę", "manipulowanie płatnością, czasem lub komunikacją z API", "wykorzystywanie błędów zamiast ich zgłoszenia"] },
  { title: "7. Zmiany i kontakt", paragraphs: ["Istotne zmiany regulaminu będą komunikowane z wyprzedzeniem. Pytania i zgłoszenia można przesłać w centrum pomocy po zalogowaniu."] },
]} />; }
