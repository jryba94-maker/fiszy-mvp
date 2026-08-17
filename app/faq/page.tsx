import type { Metadata } from "next";
import { LegalPage } from "../components/legal/LegalPage";
export const metadata: Metadata = { title: "FAQ", description: "Najczęstsze pytania o Fiszy." };
export default function Page() { return <LegalPage eyebrow="Pomoc" title="Najczęstsze pytania" lead="Krótkie odpowiedzi o kontach, aukcjach, płatnościach i dostawie." sections={[
  { title: "Czy konto działa na telefonie i komputerze?", paragraphs: ["Tak. Historia nowego ruchu jest przypisana do zalogowanego konta Clerk, więc pojawia się na każdym urządzeniu po zalogowaniu tym samym sposobem."] },
  { title: "Dlaczego płacę za wejście?", paragraphs: ["Opłata dotyczy dostępu do jednej rundy. Jej wysokość jest widoczna przed rozpoczęciem płatności. Szczegóły i zasady zwrotów muszą być zatwierdzone w finalnym regulaminie."] },
  { title: "Kto wygrywa?", paragraphs: ["Pierwsza poprawna operacja zapisana przez serwer po aktualnej cenie. Samo wyświetlenie przycisku lub wolniejsze przekierowanie nie oznacza zwycięstwa."] },
  { title: "Gdzie jest moje zamówienie?", paragraphs: ["W Moje Fiszy zobaczysz status realizacji i — po nadaniu — przewoźnika oraz numer śledzenia."] },
  { title: "Jak obserwować aukcję?", paragraphs: ["Zaloguj się i użyj przycisku Obserwuj na karcie aukcji. Możesz też pobrać wydarzenie do kalendarza."] },
  { title: "Jak skontaktować się z obsługą?", paragraphs: ["W Moje Fiszy utwórz zgłoszenie. Otrzymasz numer, status i odpowiedź zapisaną na koncie."] },
  { title: "Jak usunąć konto lub pobrać dane?", paragraphs: ["W sekcji Twój profil możesz pobrać eksport i złożyć wniosek o usunięcie. Dane wymagane prawem mogą pozostać przez obowiązkowy okres."] },
]} />; }
