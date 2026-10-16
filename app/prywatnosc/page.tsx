import type { Metadata } from "next";
import { LegalPage } from "../components/legal/LegalPage";
import { sellerDetails, sellerIdentification } from "../../lib/seller";
import { QUEUE_RULE, paymentOperatorText, LEGAL_VERSION } from "../../lib/legal-content";
export const metadata: Metadata = { title: "Polityka prywatności" };
export default function Page() { const seller = sellerDetails(); const sections = [
  {
    "title": "1. Administrator i kontakt",
    "paragraphs": [
      "SELLER",
      "W sprawach ochrony danych: kontakt@fiszy.pl."
    ]
  },
  {
    "title": "2. Zakres i źródła danych",
    "paragraphs": [
      "Przetwarzamy identyfikator konta i e-mail przekazane przez dostawcę logowania, dane profilu i potwierdzenie pełnoletności, imię i nazwisko, telefon i adres dostawy. Zapisujemy obserwowane aukcje, wejścia, ceny i czas kliknięć, pozycję kolejki, zgody i ich wersje, rabaty, zamówienia, status płatności i zwrotów oraz zgłoszenia i korespondencję.",
      "Operator przekazuje identyfikatory, kwoty, statusy i niezbędne dane płatnika. Fiszy nie otrzymuje kodu BLIK ani pełnych danych karty lub logowania do banku. Dane techniczne obejmują informacje o przeglądarce, błędach, żądaniach, adresie IP lub jego pseudonimie oraz źródle wejścia, zależnie od działającej funkcji."
    ]
  },
  {
    "title": "3. Cele i podstawy",
    "paragraphs": [
      "Konto, udział w aukcji, kolejka, płatność, dostawa i obsługa zamówienia: wykonanie umowy lub działania przed jej zawarciem (art. 6 ust. 1 lit. b RODO). Obowiązki księgowe, podatkowe i konsumenckie: obowiązek prawny (lit. c). Bezpieczeństwo, zapobieganie oszustwom, obsługa roszczeń i podstawowy pomiar niezawodności: prawnie uzasadniony interes (lit. f).",
      "Lista informacji o pierwszej aukcji i opcjonalny marketing: dobrowolna zgoda (lit. a); możesz ją wycofać. Potwierdzenia transakcji nie są uzależnione od zgody marketingowej. Podanie danych niezbędnych do umowy jest dobrowolne, ale bez nich nie można jej wykonać."
    ]
  },
  {
    "title": "4. Odbiorcy",
    "paragraphs": [
      "Clerk obsługuje logowanie; Vercel hosting i pomiar działania, Upstash przechowywanie danych, Sentry diagnostykę błędów, Resend wiadomości transakcyjne, a home.pl pocztę. Przewoźnik InPost otrzymuje dane konieczne do dostawy. Dane mogą otrzymać uprawnieni księgowi, doradcy i organy publiczne na właściwej podstawie.",
      "Aktualny operator płatności otrzymuje dane płatnika i informacje niezbędne do transakcji, zapobiegania nadużyciom i rozliczenia. Przy płatności Stripe dane otrzymuje Stripe; przy uruchomionej płatności Autopay — Autopay S.A. z siedzibą w Sopocie, ul. Powstańców Warszawy 6, jako odrębny administrator w zakresie swoich obowiązków. Nie przekazujemy danych Autopay tylko dlatego, że konto istnieje w Fiszy. Polityki operatorów są dostępne na stripe.com/privacy oraz autopay.pl/polityka-prywatnosci."
    ]
  },
  {
    "title": "5. Transfer poza EOG",
    "paragraphs": [
      "Dostawcy technologiczni mogą przetwarzać dane poza EOG, w tym w USA. Wymagany jest właściwy mechanizm ochrony: decyzja o adekwatności, w tym Data Privacy Framework gdy ma zastosowanie, albo standardowe klauzule umowne wraz z wymaganymi zabezpieczeniami. Informacje o stosowanym zabezpieczeniu można uzyskać od administratora."
    ]
  },
  {
    "title": "6. Okresy przechowywania",
    "paragraphs": [
      "Dane konta przechowujemy na czas jego działania, a po zamknięciu jedynie w zakresie obowiązków i roszczeń. Dokumenty rozliczeniowe co do zasady 5 lat od końca roku, w którym upłynął termin płatności podatku, jeżeli obowiązek ten ma zastosowanie. Dane transakcji, zgód i sporów zachowujemy do upływu właściwego okresu przedawnienia; zabezpieczenie roszczeń może wymagać dłuższego zachowania konkretnej sprawy.",
      "Listę pierwszej aukcji przechowujemy do wysłania zapowiedzianej informacji lub cofnięcia zgody, z minimalnym dowodem zgody na czas obrony roszczeń. Krótkotrwałe blokady i limity wygasają według ich funkcji; dokumentacja transakcji nie znika razem z blokadą techniczną. Żądania usunięcia rozpatrujemy z uwzględnieniem wymaganych prawem wyjątków."
    ]
  },
  {
    "title": "7. Twoje prawa",
    "paragraphs": [
      "Możesz żądać dostępu, sprostowania, usunięcia, ograniczenia przetwarzania i przeniesienia danych w ustawowym zakresie. Możesz wnieść sprzeciw wobec przetwarzania na podstawie uzasadnionego interesu oraz wycofać zgodę bez wpływu na zgodność wcześniejszego przetwarzania. Skargę można złożyć do Prezesa UODO. Wniosek wyślij na kontakt@fiszy.pl; możemy zweryfikować tożsamość, aby chronić dane."
    ]
  },
  {
    "title": "8. Kolejka i automatyczne przetwarzanie",
    "paragraphs": [
      "Serwer automatycznie ustala cenę według harmonogramu, kolejność według zapisu poprawnych zgłoszeń i dostęp według potwierdzonej płatności. Nie ma losowania ani profilowania ceny na podstawie cech osoby. Decyzja płatnicza operatora może wpływać na realizację zakupu. W sprawie błędu lub zakwestionowania wyniku możesz poprosić obsługę o weryfikację zapisów i wyjaśnienie. Cookies i ustawienia pomiaru opisuje strona Cookies."
    ]
  }
];
sections[0].paragraphs[0] = sellerIdentification();
return <LegalPage eyebrow={`Dokumenty · wersja ${LEGAL_VERSION}`} title="Polityka prywatności" lead="Dane konta, aukcji, płatności, zamówień, dostawy i kontaktu z Fiszy." sections={sections} />; }
