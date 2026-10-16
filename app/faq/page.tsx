import type { Metadata } from "next";
import { serializeJsonLd } from "../../lib/seo";
import { InfoPage } from "../components/public/InfoPage";

export const metadata: Metadata = {
  title: "FAQ — jak działa Fiszy",
  description: "Najczęstsze pytania o Fiszy, aukcje holenderskie, spadającą cenę, kolejkę i płatności.",
  alternates: { canonical: "/faq" },
};

const faq = [
  {
    question: "Czym jest Fiszy?",
    answer: "Fiszy to platforma zakupowa oparta na aukcjach holenderskich. Cena produktu spada w czasie. Kliknięcie zapisuje cenę i pozycję w kolejce; produkt kupuje osoba, której płatność zostanie potwierdzona zgodnie z kolejnością.",
  },
  {
    question: "Co to jest aukcja holenderska?",
    answer: "To aukcja, w której cena zaczyna wysoko i maleje zamiast rosnąć. Uczestnicy nie podbijają stawki — wybierają moment zakupu.",
  },
  {
    question: "Dlaczego cena spada?",
    answer: "Mechanika aukcji Fiszy obniża cenę w czasie zgodnie z zasadami konkretnej rundy. Im dłużej czekasz, tym mniej możesz zapłacić, ale ktoś inny może zdecydować się wcześniej.",
  },
  {
    question: "Kiedy zakup jest potwierdzony?",
    answer: "Kliknięcie zapisuje cenę i miejsce w kolejce. Pierwsza osoba ma 2 minuty na rozpoczęcie płatności. Po jej przyjęciu przez operatora produkt pozostaje zarezerwowany do ostatecznego wyniku. Potwierdzona płatność kończy aukcję; po potwierdzonym niepowodzeniu płaci kolejna osoba.",
  },
  {
    question: "Czy muszę licytować?",
    answer: "Nie. W Fiszy nie podbijasz ceny. Obserwujesz jej spadek i klikasz, kiedy aktualna cena Ci odpowiada.",
  },
  {
    question: "Dlaczego płacę za wejście?",
    answer: "Opłata dotyczy dostępu do jednej rundy. Jej wysokość jest widoczna przed rozpoczęciem płatności. Szczegóły dotyczące opłat i zwrotów znajdziesz w regulaminie oraz zasadach konkretnej aukcji.",
  },
  {
    question: "Gdzie jest moje zamówienie?",
    answer: "W Moje Fiszy zobaczysz status realizacji i — po nadaniu — przewoźnika oraz numer śledzenia.",
  },
  {
    question: "Jak obserwować aukcję?",
    answer: "Zaloguj się i użyj przycisku Obserwuj na karcie aukcji. Możesz też dodać wydarzenie do kalendarza.",
  },
];

export default function Page() {
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(structuredData) }}
      />
      <InfoPage
        eyebrow="Pomoc"
        title="Najczęstsze pytania"
        lead="Proste odpowiedzi o Fiszy, aukcjach holenderskich, spadającej cenie i zakupie."
        sections={faq.map((item) => ({
          title: item.question,
          paragraphs: [item.answer],
        }))}
      />
    </>
  );
}
