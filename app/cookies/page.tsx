import type { Metadata } from "next";
import { LegalPage } from "../components/legal/LegalPage";
export const metadata: Metadata = { title: "Cookies", description: "Informacje o plikach cookies w Fiszy." };
export default function Page() { return <LegalPage eyebrow="Ustawienia przeglądarki" title="Cookies i podobne technologie" lead="Co jest niezbędne do działania konta, a co zależy od zgody." sections={[
  { title: "Niezbędne", paragraphs: ["Cookies sesyjne pozwalają bezpiecznie logować użytkownika i administratora, zapobiegać nadużyciom oraz utrzymywać ustawienia wymagane do działania serwisu. Nie można ich wyłączyć z poziomu portalu bez utraty części funkcji."] },
  { title: "Analityka", paragraphs: ["Vercel Web Analytics i Speed Insights mierzą działanie oraz wydajność. Przed publicznym startem konfiguracja musi respektować wybór analityki zapisany w profilu i właściwe przepisy dotyczące zgody."] },
  { title: "Dostawcy zewnętrzni", bullets: ["Clerk — logowanie i sesja użytkownika", "Vercel — hosting, bezpieczeństwo i pomiar wydajności", "operator płatności — tylko po rozpoczęciu płatności"] },
  { title: "Zarządzanie", paragraphs: ["Preferencje dobrowolnej analityki i marketingu znajdują się w Moje Fiszy. Ustawienia przeglądarki mogą dodatkowo usuwać lub blokować cookies, co może wylogować użytkownika."] },
]} />; }
