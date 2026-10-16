import type { Metadata } from "next";
import { LegalPage } from "../components/legal/LegalPage";
import { sellerDetails, sellerIdentification } from "../../lib/seller";
import { QUEUE_RULE, paymentOperatorText, LEGAL_VERSION } from "../../lib/legal-content";
export const metadata: Metadata = { title: "Zasady aukcji" };
export default function Page() { const seller = sellerDetails(); const sections = [
  {
    "title": "Dostęp do jednej aukcji",
    "paragraphs": [
      "Przed opłatą pokazujemy produkt, start, cenę początkową i minimalną, parametry spadku oraz cenę usługi dostępu. Wejście jest dostępne przed startem dla pełnoletnich posiadaczy konta. Nie przechodzi na inną aukcję. Potwierdzenie płatności musi dotrzeć przed rozpoczęciem; spóźniona opłata nie przyznaje wejścia i podlega zwrotowi. Usługa dostępu jest oddzielna od zakupu produktu; zasady odstąpienia i reklamacji opisuje Regulamin."
    ]
  },
  {
    "title": "Cena i kolejność",
    "paragraphs": [
      "Cena obniża się zgodnie z harmonogramem konkretnej aukcji do wskazanego minimum. Zegar urządzenia i odświeżanie strony nie wpływają na cenę ani kolejność. Serwer odrzuca nieaktualne żądanie ceny. Każdy poprawny zapis w kolejce zachowuje własną cenę; późniejszy spadek jej nie zmienia. Mechanika nie zawiera losowania."
    ]
  },
  {
    "title": "Rezerwacja i potwierdzenie",
    "paragraphs": [
      "QUEUE",
      "OPERATOR",
      "Osoby oczekujące widzą pozycję i, gdy można ją oszacować, czas do swojej tury. Nie gwarantujemy czasu rozpatrzenia płatności przez bank. Po potwierdzeniu zakupu pozostałe osoby nie przechodzą do płatności za ten produkt. Samo kliknięcie lub ekran powrotu z banku nie kończy aukcji."
    ]
  },
  {
    "title": "Zwroty i rabat",
    "paragraphs": [
      "Jeśli nie możemy przyznać dostępu albo unieważnimy aukcję z przyczyn niezależnych od uczestnika, zlecamy zwrot wejścia do 7 dni. Należne zwroty nie są zastępowane rabatem. Uczestnicy spełniający warunki oferty po aukcji otrzymują osobny, jednorazowy rabat na ten sam produkt; kwota i termin widoczne są przed wejściem i na koncie. Dostępność produktu może być ograniczona."
    ]
  }
];
sections[2].paragraphs[0] = QUEUE_RULE; sections[2].paragraphs[1] = paymentOperatorText();
return <LegalPage eyebrow={`Dokumenty · wersja ${LEGAL_VERSION}`} title="Zasady aukcji" lead="Cena i kolejność są zapisywane przez serwer. O zakupie rozstrzyga potwierdzona płatność." sections={sections} />; }
