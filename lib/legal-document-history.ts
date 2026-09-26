export type LegalDocumentVersion = {
  id: string;
  title: string;
  version: string;
  effectiveAt: string;
  publishedAt: string;
  status: "active" | "archived";
  fileName: string;
  content: string;
};

const EFFECTIVE_AT = "2026-09-27T00:00:00+02:00";

export const legalDocumentHistory: LegalDocumentVersion[] = [
  { id: "regulamin", title: "Regulamin portalu", version: "1.0", effectiveAt: EFFECTIVE_AT, publishedAt: EFFECTIVE_AT, status: "active", fileName: "fiszy-regulamin-v1.0-2026-09-27.md", content: "# Regulamin portalu Fiszy\n\nWersja 1.0 · obowiązuje od 27.09.2026\n\nFiszy jest portalem aukcji z malejącą ceną, prowadzonym przez Jakuba Rybę. Udział jest przeznaczony dla osób 18+. Dostawa InPost na terenie Polski jest bezpłatna. Szczegóły mechaniki opisują Zasady aukcji." },
  { id: "zasady-aukcji", title: "Zasady aukcji", version: "1.0", effectiveAt: EFFECTIVE_AT, publishedAt: EFFECTIVE_AT, status: "active", fileName: "fiszy-zasady-aukcji-v1.0-2026-09-27.md", content: "# Zasady aukcji Fiszy\n\nWersja 1.0 · obowiązuje od 27.09.2026\n\nCena startowa odpowiada wartości rynkowej, a cena minimalna wynosi 1 zł. Serwer zapisuje cenę i kolejność kliknięcia. Osoba, której przypada kolej, ma 2 minuty na płatność Stripe; po nieudanej płatności szansa przechodzi do następnej osoby w kolejce." },
  { id: "prywatnosc", title: "Polityka prywatności", version: "1.0", effectiveAt: EFFECTIVE_AT, publishedAt: EFFECTIVE_AT, status: "active", fileName: "fiszy-polityka-prywatnosci-v1.0-2026-09-27.md", content: "# Polityka prywatności Fiszy\n\nWersja 1.0 · obowiązuje od 27.09.2026\n\nAdministratorem danych jest Jakub Ryba — właściciel Fiszy. Kontakt: rodo@fiszy.pl." },
  { id: "cookies", title: "Cookies i podobne technologie", version: "1.0", effectiveAt: EFFECTIVE_AT, publishedAt: EFFECTIVE_AT, status: "active", fileName: "fiszy-cookies-v1.0-2026-09-27.md", content: "# Cookies i podobne technologie\n\nWersja 1.0 · obowiązuje od 27.09.2026\n\nCookies niezbędne obsługują logowanie, bezpieczeństwo i ustawienia. Dobrowolna analityka jest używana zgodnie z wyborem użytkownika." },
  { id: "reklamacje", title: "Reklamacje i zwroty", version: "1.0", effectiveAt: EFFECTIVE_AT, publishedAt: EFFECTIVE_AT, status: "active", fileName: "fiszy-reklamacje-i-zwroty-v1.0-2026-09-27.md", content: "# Reklamacje i zwroty Fiszy\n\nWersja 1.0 · obowiązuje od 27.09.2026\n\nKonsument może odstąpić od umowy w ciągu 14 dni od otrzymania produktu, z wyjątkami przewidzianymi przez prawo. Koszt odesłania produktu ponosi konsument, chyba że uzgodnimy inaczej." },
];

export function findLegalDocumentVersion(id: string, version: string) {
  return legalDocumentHistory.find((item) => item.id === id && item.version === version) ?? null;
}
