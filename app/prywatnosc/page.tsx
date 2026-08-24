import type { Metadata } from "next";
import Link from "next/link";
import styles from "./privacy.module.css";

export const metadata: Metadata = {
  title: "Polityka prywatności listy Fiszy",
  description: "Zasady przetwarzania adresów e-mail zapisanych na listę pierwszej aukcji Fiszy.",
  alternates: { canonical: "/prywatnosc" },
};

export default function PrivacyPage() {
  return (
    <main className={styles.page}>
      <header className={styles.topbar}>
        <Link className={styles.logo} href="/" aria-label="Fiszy — strona główna">Fiszy<span>.</span></Link>
        <Link className={styles.back} href="/">Wróć do strony</Link>
      </header>

      <article className={styles.document}>
        <header className={styles.hero}>
          <p className={styles.eyebrow}>Lista pierwszej aukcji</p>
          <h1>Polityka prywatności</h1>
          <p className={styles.lead}>Ta polityka dotyczy wyłącznie adresów e-mail pozostawionych na stronie fiszy.pl w celu otrzymania informacji o starcie pierwszej aukcji.</p>
          <p className={styles.updated}>Obowiązuje od 24 sierpnia 2026 r.</p>
        </header>

        <section>
          <h2>1. Kto jest administratorem danych?</h2>
          <p>Administratorem Twoich danych osobowych jest <strong>Jakub Ryba, operator serwisu Fiszy</strong>.</p>
          <p>W każdej sprawie dotyczącej danych lub wycofania zgody możesz napisać na <a href="mailto:rodo@fiszy.pl">rodo@fiszy.pl</a>.</p>
        </section>

        <section>
          <h2>2. Jakie dane zapisujemy?</h2>
          <ul>
            <li>adres e-mail podany w formularzu,</li>
            <li>datę oraz wersję udzielonej zgody,</li>
            <li>źródło wejścia na stronę, np. oznaczenia kampanii UTM i domenę strony odsyłającej, jeśli te informacje są dostępne,</li>
            <li>krótkotrwałe dane techniczne potrzebne do ochrony formularza przed automatycznymi nadużyciami; adres IP jest w tym celu pseudonimizowany.</li>
          </ul>
        </section>

        <section>
          <h2>3. Po co i na jakiej podstawie?</h2>
          <p>Adres e-mail wykorzystamy wyłącznie do wysłania informacji związanej ze startem pierwszej aukcji Fiszy. Podstawą przetwarzania jest Twoja dobrowolna zgoda — art. 6 ust. 1 lit. a RODO.</p>
          <p>Dane techniczne służące ochronie formularza przetwarzamy na podstawie naszego prawnie uzasadnionego interesu polegającego na zapewnieniu bezpieczeństwa strony i zapobieganiu nadużyciom — art. 6 ust. 1 lit. f RODO.</p>
          <p>Podanie adresu jest dobrowolne. Bez niego nie będziemy mogli wysłać powiadomienia.</p>
        </section>

        <section>
          <h2>4. Komu możemy przekazać dane?</h2>
          <p>Dostęp do danych mogą mieć wyłącznie dostawcy niezbędni do obsługi formularza i wiadomości: Vercel — hosting strony i podstawowy pomiar jej działania, Upstash — przechowywanie listy oraz home.pl — obsługa poczty e-mail.</p>
          <p>Dostawcy przetwarzają dane na podstawie umów i tylko w zakresie potrzebnym do świadczenia swoich usług.</p>
        </section>

        <section>
          <h2>5. Czy dane trafiają poza EOG?</h2>
          <p>Niektórzy dostawcy technologiczni mogą przetwarzać dane poza Europejskim Obszarem Gospodarczym, w szczególności w Stanach Zjednoczonych. W takim przypadku stosowany jest właściwy mechanizm prawny, np. decyzja Komisji Europejskiej stwierdzająca odpowiedni stopień ochrony, EU–US Data Privacy Framework — gdy ma zastosowanie — albo standardowe klauzule umowne.</p>
        </section>

        <section>
          <h2>6. Jak długo przechowujemy dane?</h2>
          <p>Adres e-mail przechowujemy do czasu wysłania informacji o pierwszej aukcji albo do wcześniejszego wycofania zgody. Dane techniczne ograniczające nadużycia wygasają co do zasady po 10 minutach.</p>
          <p>Po wycofaniu zgody możemy zachować wyłącznie minimalną informację potrzebną do wykazania, że zgoda została prawidłowo udzielona i następnie wycofana, przez okres wymagany do obrony przed roszczeniami.</p>
        </section>

        <section>
          <h2>7. Jakie masz prawa?</h2>
          <p>Możesz zażądać dostępu do danych, ich sprostowania, usunięcia lub ograniczenia przetwarzania, przeniesienia danych oraz wnieść sprzeciw wobec przetwarzania opartego na prawnie uzasadnionym interesie.</p>
          <p>Zgodę możesz wycofać w dowolnej chwili, pisząc na <a href="mailto:rodo@fiszy.pl">rodo@fiszy.pl</a>. Wycofanie zgody nie wpływa na zgodność wcześniejszego przetwarzania z prawem.</p>
          <p>Masz prawo wnieść skargę do Prezesa Urzędu Ochrony Danych Osobowych.</p>
        </section>

        <section>
          <h2>8. Automatyczne decyzje</h2>
          <p>Dane z formularza nie są wykorzystywane do profilowania ani podejmowania wobec Ciebie decyzji wywołujących skutki prawne lub w podobny sposób istotnie na Ciebie wpływających.</p>
        </section>

        <footer className={styles.footer}>
          <p>Kontakt w sprawach danych osobowych</p>
          <a href="mailto:rodo@fiszy.pl">rodo@fiszy.pl</a>
        </footer>
      </article>
    </main>
  );
}
