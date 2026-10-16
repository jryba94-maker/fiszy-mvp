import type { Metadata } from "next";
import { LegalPage } from "../components/legal/LegalPage";
import { sellerDetails, sellerIdentification } from "../../lib/seller";
import { QUEUE_RULE, paymentOperatorText, LEGAL_VERSION } from "../../lib/legal-content";
export const metadata: Metadata = { title: "Reklamacje i odstąpienie" };
export default function Page() { const seller = sellerDetails(); const sections = [
  {
    "title": "Kontakt",
    "paragraphs": [
      "SELLER",
      "Zgłoszenie przyjmujemy również w Moje Fiszy → Pomoc i reklamacje. Podaj dane umożliwiające odpowiedź, numer zamówienia lub aukcję, opis problemu i żądanie. Brak numeru nie wyłącza rozpoznania reklamacji."
    ]
  },
  {
    "title": "Niezgodność produktu z umową",
    "paragraphs": [
      "Sprzedawca odpowiada za brak zgodności towaru z umową ujawniony w ciągu 2 lat od dostarczenia. Konsument może żądać naprawy lub wymiany, a w przypadkach ustawowych obniżenia ceny lub odstąpienia. Niezbędne koszty reklamacji ponosi sprzedawca. Ewentualna gwarancja producenta jest odrębna i nie ogranicza tych praw. Na reklamację konsumenta odpowiadamy do 14 dni od otrzymania."
    ]
  },
  {
    "title": "Odstąpienie od zakupu produktu",
    "paragraphs": [
      "Masz 14 dni od otrzymania produktu na wysłanie oświadczenia e-mailem, pocztą lub przez konto; skorzystanie z poniższego wzoru jest dobrowolne. Towar odeślij do 14 dni od odstąpienia na adres zwrotów sprzedawcy. Bezpośredni koszt odesłania ponosi konsument. Odpowiedzialność za zmniejszenie wartości dotyczy korzystania wykraczającego poza konieczne sprawdzenie cech i działania produktu.",
      "Zwracamy płatności, w tym koszt najtańszej zwykłej oferowanej dostawy, do 14 dni od otrzymania odstąpienia, tą samą metodą, chyba że bezkosztowo uzgodnimy inaczej. Możemy wstrzymać zwrot do otrzymania rzeczy lub dowodu odesłania. Wyjątki od odstąpienia obowiązują wyłącznie w przypadkach ustawowych; nie wyłączamy go samą nazwą aukcji.",
      "RETURN"
    ]
  },
  {
    "title": "Usługa dostępu do aukcji",
    "paragraphs": [
      "14 dni na odstąpienie liczy się od zawarcia umowy o usługę. Utrata prawa następuje dopiero po pełnym wykonaniu usługi, jeżeli wcześniej wyraźnie zażądano jej rozpoczęcia i przyjęto informację o tym skutku. Przed pełnym wykonaniem zachowujesz prawo odstąpienia; zgodnie z ustawą może być należna proporcjonalna zapłata za faktycznie wykonane świadczenie. Zwrot za brak dostępu lub unieważnioną aukcję zlecamy do 7 dni."
    ]
  },
  {
    "title": "Dobrowolny wzór odstąpienia",
    "paragraphs": [
      "Adresat: sprzedawca Fiszy (dane kontaktowe powyżej). Informuję o odstąpieniu od umowy dotyczącej [produkt/usługa wejścia]. Numer zamówienia/aukcja: […]. Data zawarcia umowy/otrzymania: […]. Imię, nazwisko, adres i kontakt konsumenta: […]. Data: […]. Podpis wymagany wyłącznie przy oświadczeniu na papierze."
    ]
  }
];
sections[0].paragraphs[0] = sellerIdentification(); sections[2].paragraphs[2] = seller.returnAddress ? `Adres zwrotów: ${seller.returnAddress}.` : `Adres zwrotu potwierdzimy przez ${seller.email}.`;
return <LegalPage eyebrow={`Dokumenty · wersja ${LEGAL_VERSION}`} title="Reklamacje i odstąpienie" lead="Kontakt bez obowiązku logowania oraz ustawowe prawa dotyczące produktu i usługi wejścia." sections={sections} />; }
