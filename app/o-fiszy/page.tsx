import type { Metadata } from "next";
import { InfoPage } from "../components/public/InfoPage";

export const metadata: Metadata = {
  title: "O Fiszy",
  description:
    "Fiszy to polska platforma zakupowa oparta na aukcjach holenderskich, w których cena produktu spada w czasie.",
  alternates: { canonical: "/o-fiszy" },
};

export default function AboutFiszyPage() {
  return (
    <InfoPage
      eyebrow="O Fiszy"
      title="Przywracamy emocje zakupów."
      lead="Fiszy to polska platforma zakupowa oparta na aukcjach holenderskich, w których cena produktu spada w czasie, a pierwsza osoba, która zdecyduje się kupić po aktualnej cenie, wygrywa aukcję."
      sections={[
        {
          title: "Inny kierunek niż klasyczna licytacja",
          paragraphs: [
            "W klasycznej aukcji uczestnicy podbijają cenę. W Fiszy jest odwrotnie: cena maleje, a napięcie rośnie wraz z pytaniem, jak długo warto czekać.",
          ],
        },
        {
          title: "Moment decyzji jest częścią zakupu",
          paragraphs: [
            "Użytkownik nie walczy o najwyższą ofertę. Wybiera moment, w którym aktualna cena jest dla niego wystarczająco dobra.",
          ],
        },
        {
          title: "Fiszy. Przywracamy emocje zakupów.",
          paragraphs: [
            "Celem Fiszy jest połączenie zakupów z oczekiwaniem, decyzją i poczuciem, że każda sekunda może mieć znaczenie.",
          ],
        },
      ]}
    />
  );
}
