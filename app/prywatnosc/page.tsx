import type { Metadata } from "next";
import Link from "next/link";
import styles from "./privacy.module.css";

export const metadata: Metadata = {
  title: "Polityka prywatności",
  description: "Jak Fiszy przetwarza i chroni dane osobowe.",
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
          <p className={styles.eyebrow}>Ochrona danych</p>
          <h1>Polityka prywatności</h1>
          <p className={styles.lead}>Poniżej wyjaśniamy prostym językiem, jakie dane przetwarza Fiszy, po co to robi i jakie prawa Ci przysługują.</p>
          <p className={styles.updated}>Obowiązuje od 24 sierpnia 2026 r.</p>
        </header>

        <section>
          <h2>1. Administrator danych</h2>
          <p>Administratorem Twoich danych osobowych jest <strong>Jakub Ryba, operator serwisu Fiszy</strong>.</p>
          <p>W sprawach dotyczących prywatności, swoich danych lub realizacji praw skontaktuj się pod adresem <a href="mailto:rodo@fiszy.pl">rodo@fiszy.pl</a>.</p>
          <p>Administrator nie wyznaczył inspektora ochrony danych. Kontakt podany powyżej służy bezpośrednio do wszystkich spraw dotyczących RODO.</p>
        </section>

        <section>
          <h2>2. Jakie dane przetwarzamy</h2>
          <ul>
            <li><strong>Lista pierwszej aukcji:</strong> adres e-mail, data i wersja zgody oraz źródło wejścia na stronę, w tym oznaczenia UTM i domena strony odsyłającej.</li>
            <li><strong>Konto użytkownika:</strong> identyfikator konta, adres e-mail, dane logowania obsługiwane przez Clerk oraz dobrowolnie uzupełnione dane profilu.</li>
            <li><strong>Udział w aukcji i zamówienie:</strong> historia wejść, kliknięć i wygranych, dane zamówienia, dane dostawy oraz referencje płatności. Fiszy nie przechowuje pełnych danych karty.</li>
            <li><strong>Kontakt i obsługa:</strong> treść wiadomości, zgłoszeń i reklamacji oraz informacje potrzebne do ich rozpatrzenia.</li>
            <li><strong>Dane techniczne i bezpieczeństwa:</strong> adres IP przetwarzany lub pseudonimizowany na potrzeby ochrony przed nadużyciami, dane przeglądarki i urządzenia, zdarzenia techniczne oraz logi bezpieczeństwa.</li>
          </ul>
          <p>Dane otrzymujemy bezpośrednio od Ciebie, z Twojego urządzenia podczas korzystania z serwisu oraz od dostawców obsługujących logowanie i płatności.</p>
        </section>

        <section>
          <h2>3. Cele i podstawy prawne</h2>
          <div className={styles.tableWrap}>
            <table>
              <thead><tr><th>Cel</th><th>Podstawa prawna</th></tr></thead>
              <tbody>
                <tr><td>Wysłanie informacji o pierwszej aukcji</td><td>Twoja zgoda — art. 6 ust. 1 lit. a RODO</td></tr>
                <tr><td>Utworzenie konta, udział w aukcji, płatność i realizacja zamówienia</td><td>Wykonanie umowy lub działania przed jej zawarciem — art. 6 ust. 1 lit. b RODO</td></tr>
                <tr><td>Rozliczenia i obowiązki podatkowe</td><td>Obowiązek prawny — art. 6 ust. 1 lit. c RODO</td></tr>
                <tr><td>Bezpieczeństwo serwisu, zapobieganie nadużyciom, diagnostyka i obrona roszczeń</td><td>Prawnie uzasadniony interes administratora — art. 6 ust. 1 lit. f RODO</td></tr>
                <tr><td>Pomiar działania strony i skuteczności źródeł ruchu bez tworzenia profilu reklamowego</td><td>Prawnie uzasadniony interes administratora w rozwijaniu serwisu — art. 6 ust. 1 lit. f RODO</td></tr>
              </tbody>
            </table>
          </div>
          <p>Podanie adresu e-mail na liście oczekujących jest dobrowolne, ale bez niego nie możemy wysłać informacji o starcie. Dane wymagane przy koncie, płatności i dostawie są potrzebne do realizacji wybranej usługi lub zamówienia.</p>
        </section>

        <section>
          <h2>4. Odbiorcy danych</h2>
          <p>Dane mogą otrzymywać wyłącznie podmioty, które pomagają nam świadczyć usługę: dostawca hostingu i analityki Vercel, dostawca bazy danych Upstash, dostawca logowania Clerk, operator płatności Stripe, dostawca poczty home.pl oraz — po zakupie — podmioty realizujące dostawę, księgowość lub obsługę prawną.</p>
          <p>Podmioty te przetwarzają dane na nasze polecenie albo działają jako odrębni administratorzy w zakresie wynikającym z prawa i charakteru własnej usługi.</p>
        </section>

        <section>
          <h2>5. Przekazywanie danych poza EOG</h2>
          <p>Niektórzy dostawcy technologiczni mogą przetwarzać dane poza Europejskim Obszarem Gospodarczym, w szczególności w Stanach Zjednoczonych. W takim przypadku transfer odbywa się na podstawie decyzji Komisji Europejskiej stwierdzającej odpowiedni stopień ochrony, udziału dostawcy w EU–US Data Privacy Framework — gdy ma zastosowanie — albo standardowych klauzul umownych wraz z wymaganymi zabezpieczeniami.</p>
          <p>Informację o właściwym mechanizmie lub kopię stosowanych zabezpieczeń możesz uzyskać, pisząc na <a href="mailto:rodo@fiszy.pl">rodo@fiszy.pl</a>.</p>
        </section>

        <section>
          <h2>6. Jak długo przechowujemy dane</h2>
          <ul>
            <li>Adres z listy pierwszej aukcji — do wysłania informacji o starcie albo do wcześniejszego wycofania zgody.</li>
            <li>Dane konta — przez czas korzystania z konta, a po jego zamknięciu przez okres potrzebny do rozliczeń i obrony roszczeń.</li>
            <li>Dane zamówień i rozliczeń — przez okres wymagany przepisami podatkowymi i rachunkowymi oraz do czasu przedawnienia roszczeń.</li>
            <li>Zgłoszenia — przez czas obsługi sprawy, a następnie do czasu przedawnienia związanych z nią roszczeń.</li>
            <li>Techniczne ograniczenia nadużyć — co do zasady krótkotrwale; licznik zapisów na listę wygasa po 10 minutach.</li>
          </ul>
        </section>

        <section>
          <h2>7. Twoje prawa</h2>
          <p>W zależności od podstawy przetwarzania możesz żądać dostępu do danych i ich kopii, sprostowania, usunięcia, ograniczenia przetwarzania, przeniesienia danych lub wnieść sprzeciw wobec przetwarzania opartego na prawnie uzasadnionym interesie.</p>
          <p>Zgodę możesz wycofać w dowolnym momencie, pisząc na <a href="mailto:rodo@fiszy.pl">rodo@fiszy.pl</a>. Wycofanie zgody nie wpływa na zgodność wcześniejszego przetwarzania z prawem.</p>
          <p>Masz również prawo wnieść skargę do Prezesa Urzędu Ochrony Danych Osobowych.</p>
        </section>

        <section>
          <h2>8. Automatyczny wybór zwycięzcy aukcji</h2>
          <p>Mechanizm Fiszy automatycznie ustala zwycięzcę na podstawie pierwszego prawidłowo zarejestrowanego kliknięcia zakupu oraz ceny obowiązującej w tym momencie. Nie wykorzystujemy w tym celu profilowania ani oceny cech osobistych użytkownika.</p>
          <p>Automatyzacja jest niezbędna do przeprowadzenia aukcji zgodnie z jej zasadami. Jeśli uważasz, że wynik został ustalony nieprawidłowo, możesz poprosić o weryfikację przez człowieka, przedstawić swoje stanowisko i zakwestionować wynik, kontaktując się z nami.</p>
        </section>

        <section>
          <h2>9. Bezpieczeństwo i zmiany polityki</h2>
          <p>Stosujemy kontrolę dostępu, rozdzielenie środowisk, szyfrowane połączenia, ograniczenia żądań i rejestrowanie zdarzeń bezpieczeństwa. Żaden system nie gwarantuje jednak całkowitego wyeliminowania ryzyka.</p>
          <p>Politykę możemy aktualizować, gdy zmieni się serwis, dostawcy lub przepisy. Nową wersję opublikujemy pod tym samym adresem wraz z datą obowiązywania. Jeżeli zmiana będzie wymagała nowej zgody, poprosimy o nią osobno.</p>
        </section>

        <footer className={styles.footer}>
          <p>Masz pytanie dotyczące swoich danych?</p>
          <a href="mailto:rodo@fiszy.pl">rodo@fiszy.pl</a>
        </footer>
      </article>
    </main>
  );
}
