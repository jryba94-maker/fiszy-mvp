import Link from "next/link";
import styles from "./info.module.css";

export type InfoSection = {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
};

export function InfoPage({
  eyebrow,
  title,
  lead,
  sections,
}: {
  eyebrow: string;
  title: string;
  lead: string;
  sections: InfoSection[];
}) {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/" aria-label="Fiszy — strona główna">
          Fiszy<span className={styles.brandDot}>.</span>
        </Link>
        <nav className={styles.nav} aria-label="Główna nawigacja">
          <Link href="/jak-to-dziala">Jak to działa</Link>
          <Link href="/aukcja-holenderska">Aukcja holenderska</Link>
          <Link href="/o-fiszy">O Fiszy</Link>
          <Link href="/faq">FAQ</Link>
          <Link className={styles.navPrimary} href="/aukcje">Aukcje</Link>
        </nav>
      </header>

      <section className={styles.hero}>
        <p className={styles.eyebrow}>{eyebrow}</p>
        <h1>{title}</h1>
        <p className={styles.lead}>{lead}</p>
      </section>

      <article className={styles.article}>
        {sections.map((section) => (
          <section className={styles.section} key={section.title}>
            <h2>{section.title}</h2>
            {section.paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            {section.bullets ? (
              <ul>{section.bullets.map((item) => <li key={item}>{item}</li>)}</ul>
            ) : null}
          </section>
        ))}
      </article>

      <div className={styles.cta}>
        <p>Chcesz zobaczyć Fiszy w praktyce?</p>
        <Link href="/aukcje">Zobacz aukcje</Link>
      </div>

      <footer className={styles.footer}>
        <span><strong>Fiszy.</strong> Przywracamy emocje zakupów.</span>
        <nav aria-label="Informacje">
          <Link href="/jak-to-dziala">Jak to działa</Link>
          <Link href="/aukcja-holenderska">Aukcja holenderska</Link>
          <Link href="/o-fiszy">O Fiszy</Link>
          <Link href="/faq">FAQ</Link>
        </nav>
      </footer>
    </main>
  );
}
