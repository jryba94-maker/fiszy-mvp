import Link from "next/link";
import publicStyles from "../public/public.module.css";
import styles from "./legal.module.css";

export type LegalSection = { title: string; paragraphs?: string[]; bullets?: string[] };

export function LegalPage({ eyebrow, title, lead, sections }: {
  eyebrow: string;
  title: string;
  lead: string;
  sections: LegalSection[];
}) {
  return (
    <main className={styles.page}>
      <header className={publicStyles.header}>
        <Link className={publicStyles.brand} href="/" aria-label="Fiszy — strona główna">
          Fiszy<span className={publicStyles.brandDot}>.</span>
        </Link>
        <nav className={publicStyles.nav} aria-label="Główna nawigacja">
          <Link className={publicStyles.navLink} href="/aukcje#jak-to-dziala">Jak to działa</Link>
          <Link className={publicStyles.navLink} href="/faq">Pomoc</Link>
          <Link className={`${publicStyles.navLink} ${publicStyles.navLinkPrimary}`} href="/moje-fiszy">Moje Fiszy</Link>
        </nav>
      </header>
      <div className={styles.main}>
        <header className={styles.hero}>
          <p className={styles.eyebrow}>{eyebrow}</p>
          <h1>{title}</h1>
          <p>{lead}</p>
          <div className={styles.draft}>Wersja robocza portalu · wymaga zatwierdzenia prawnego przed uruchomieniem sprzedaży publicznej</div>
        </header>
        <article className={styles.article}>
          {sections.map((section) => (
            <section key={section.title}>
              <h2>{section.title}</h2>
              {section.paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              {section.bullets ? <ul>{section.bullets.map((item) => <li key={item}>{item}</li>)}</ul> : null}
            </section>
          ))}
        </article>
        <nav className={styles.legalNav} aria-label="Dokumenty i pomoc">
          <Link href="/regulamin">Regulamin</Link><Link href="/zasady-aukcji">Zasady aukcji</Link><Link href="/prywatnosc">Prywatność</Link><Link href="/cookies">Cookies</Link><Link href="/reklamacje">Reklamacje</Link><Link href="/faq">FAQ</Link>
        </nav>
      </div>
    </main>
  );
}
