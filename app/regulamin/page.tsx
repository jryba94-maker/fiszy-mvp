import type { Metadata } from "next";
import { LegalPage } from "../components/legal/LegalPage";
import { sellerDetails, sellerIdentification } from "../../lib/seller";
import { QUEUE_RULE, paymentOperatorText, LEGAL_VERSION } from "../../lib/legal-content";
export const metadata: Metadata = { title: "Regulamin portalu" };
export default function Page() { const seller = sellerDetails(); const sections = [
  {
    "title": "1. Sprzedawca i kontakt",
    "paragraphs": [
      "SELLER"
    ]
  },
  {
    "title": "2. Konto i warunki techniczne",
    "paragraphs": [
      "Fiszy sprzedaje własne produkty w aukcjach z malejącą ceną. Udział wymaga pełnoletności, konta, aktualnej przeglądarki, połączenia z internetem i prawdziwych danych dostawy. Użytkownik chroni dane logowania. Niedozwolone są boty, manipulacja kolejką i obchodzenie ograniczeń przez wiele kont. Założenie konta jest bezpłatne. Rezygnację z konta można zgłosić na adres kontaktowy; nie usuwa to dokumentów wymaganych prawem."
    ]
  },
  {
    "title": "3. Dwie odrębne umowy",
    "paragraphs": [
      "Wejście jest odpłatną usługą dostępu do jednej wskazanej aukcji; opłata nie stanowi zaliczki na produkt i nie gwarantuje jego zakupu. Umowa o usługę powstaje po potwierdzeniu opłaty przez operatora; dostęp jest przyznawany tylko po potwierdzeniu przed startem. Usługa zostaje w pełni wykonana po udostępnieniu udziału i zakończeniu aukcji.",
      "Prezentacja produktu jest zaproszeniem do złożenia oferty. Kliknięcie zakupu jest ofertą zakupu za zapisaną cenę i prośbą o rezerwację miejsca w kolejce. Umowa sprzedaży jest zawierana dopiero po skutecznej płatności potwierdzonej przez operatora i przyjęciu zamówienia przez Fiszy; potwierdzenie z ceną i danymi zamówienia przekazujemy e-mailem. Sam powrót ze strony banku nie stanowi potwierdzenia. Cena produktu i cena wejścia są kwotami brutto; dostawa w Polsce jest bezpłatna."
    ]
  },
  {
    "title": "4. Kolejka i płatności",
    "paragraphs": [
      "QUEUE",
      "OPERATOR",
      "Nie pobieramy kolejnej zapłaty za ten sam zakup w czasie przetwarzania poprzedniej. Niepewność wyniku nie zwalnia rezerwacji. Wpłata, której nie można przypisać do prawidłowego zakupu, podlega zwrotowi. Zlecenie zwrotu nie oznacza jego natychmiastowego otrzymania; termin księgowania zależy od operatora i banku."
    ]
  },
  {
    "title": "5. Dostawa",
    "paragraphs": [
      "Dostarczamy na terenie Polski przez InPost bez dodatkowej opłaty. Nadajemy przesyłkę do 3 dni roboczych od potwierdzenia płatności. Przewidywany transport po nadaniu: 1–2 dni robocze. Numer przesyłki przekazujemy na koncie. W razie opóźnienia informujemy klienta i uzgadniamy dalszą realizację."
    ]
  },
  {
    "title": "6. Odstąpienie i opłata za wejście",
    "paragraphs": [
      "Konsument ma 14 dni na odstąpienie od umowy sprzedaży od otrzymania produktu, z wyjątkami ustawowymi. Aukcja internetowa nie wyłącza sama w sobie tego uprawnienia. Szczegóły i wzór oświadczenia znajdują się na stronie Reklamacje.",
      "Od umowy o usługę wejścia można odstąpić w ciągu 14 dni od jej zawarcia. Przed płatnością osobno odbieramy wyraźne żądanie rozpoczęcia świadczenia wcześniej oraz potwierdzenie przyjęcia informacji o utracie prawa dopiero po pełnym wykonaniu usługi. Oświadczenie wraz z treścią warunków przekazujemy w potwierdzeniu e-mail. Przy odstąpieniu przed pełnym wykonaniem może być należna proporcjonalna zapłata zgodnie z ustawą.",
      "Sam brak zakupu produktu nie jest podstawą zwrotu prawidłowo wykonanej usługi. Nie ogranicza to odstąpienia, reklamacji ani zwrotu za usługę niewykonaną. Przy unieważnieniu aukcji albo braku dostępu z przyczyn po stronie Fiszy zlecamy zwrot wejścia do 7 dni. Rabat na ten sam produkt dla uprawnionych uczestników jest osobną ofertą na warunkach pokazanych na koncie; nie zastępuje należnego zwrotu."
    ]
  },
  {
    "title": "7. Reklamacje i spory",
    "paragraphs": [
      "Reklamację można złożyć e-mailem na adres sprzedawcy albo przez Moje Fiszy. Odpowiadamy konsumentowi w ciągu 14 dni. Odpowiadamy za zgodność towaru z umową na zasadach ustawowych; procedura na stronie Reklamacje nie ogranicza uprawnień ustawowych. Konsument może zwrócić się o pomoc do rzecznika konsumentów lub Inspekcji Handlowej, a także skorzystać z właściwego sądu."
    ]
  },
  {
    "title": "8. Zmiany dokumentów",
    "paragraphs": [
      "Warunki zapisane przy zawieraniu umowy nie zmieniają się wstecz. O istotnych zmianach dotyczących kont informujemy z wyprzedzeniem. Zmiana nie odbiera ustawowych praw konsumenta. Dane osobowe opisujemy w Polityce prywatności."
    ]
  }
];
sections[0].paragraphs = [sellerIdentification()]; sections[3].paragraphs[0] = QUEUE_RULE; sections[3].paragraphs[1] = paymentOperatorText();
return <LegalPage eyebrow={`Dokumenty · wersja ${LEGAL_VERSION}`} title="Regulamin portalu" lead="Zasady konta, usługi dostępu do aukcji i zakupu produktu." sections={sections} />; }
