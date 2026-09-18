import type { MarketingAgent } from "./marketing-agent-storage";

export type GrowthInput = {
  brief: string;
  motive: string;
  audience: string;
  cta: string;
  auctionProduct: string;
  auctionStartsAt: string;
  communityNotes: string;
};

type AgentMessage = { agent: MarketingAgent; content: string };

const DNA = "DNA Fiszy: minimalizm premium, czerń i biel, fioletowa kula lub oszczędny fioletowy akcent, napięcie, czas i decyzja. Nigdy SALE, czerwone ceny, dyskont, fałszywa presja ani obietnica najniższej ceny.";
const DATA_RULE = "Nie wymyślaj obserwacji, liczb ani wyników. Brak podłączonych źródeł oznacz wprost jako 'brak danych' i zaproponuj dokładny sposób ich zebrania.";

export async function runMarketingAgents(input: GrowthInput): Promise<AgentMessage[]> {
  const apiKey = process.env.FISZY_MARKETING_OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("Brak FISZY_MARKETING_OPENAI_API_KEY. Dodaj sekret środowiskowy, aby uruchomić agentów.");

  const context = `Cel: ${input.brief}\nMotyw: ${input.motive}\nOdbiorca: ${input.audience}\nCTA: ${input.cta}\nAukcja: ${input.auctionProduct || "nie wybrano"}\nStart: ${input.auctionStartsAt || "nie podano"}\nNotatki z komentarzy/DM: ${input.communityNotes || "brak danych"}`;
  const social = await ask(apiKey, `Jesteś Agentem Social Listening / konkurencja Fiszy. ${DNA}\n${DATA_RULE}\n${context}\nŹródła TikTok, Instagram, Reddit i YouTube nie są jeszcze podłączone. Zbuduj dzisiejszy research brief: 5 precyzyjnych zapytań do obserwacji, sygnały do zapisania oraz sposób wyciągania mechanizmu bez kopiowania kreacji. Na końcu podaj maksymalnie 2 hipotezy dla Creative. Pisz po polsku, zwięźle.`);
  const community = await ask(apiKey, `Jesteś Agentem Community Fiszy. ${DNA}\n${DATA_RULE}\n${context}\nSklasyfikuj dostępne notatki lub, jeśli ich brak, przygotuj taksonomię: edukacja, zaufanie/scam, pricing, produkt i obiekcja płatnego wejścia. Podaj wzór dziennego raportu, zasadę eskalacji oraz jedną najważniejszą rzecz do sprawdzenia przed automatycznym odpowiadaniem. Pisz po polsku, zwięźle.`);
  const creative = await ask(apiKey, `Jesteś Agentem Creative Fiszy. ${DNA}\n${context}\nInsight Social Listening:\n${social}\nInsight Community:\n${community}\nPrzygotuj dokładnie 3 warianty reklamy. Każdy ma: hook (maks. 8 słów), primary text, CTA, scenariusz rolki 9:16, adaptację 1:1 i prompt do video. Nie kopiuj materiałów konkurencji. Pisz po polsku, konkretnie.`);
  const landing = await ask(apiKey, `Jesteś Agentem Landing Page Fiszy. ${DNA}\n${context}\nKreacje:\n${creative}\nDla każdego z trzech kątów podaj: headline, subheadline, pierwszy dowód/zrozumienie zasad, CTA i jedną zmianę w pierwszym ekranie. Landing ma kontynuować obietnicę reklamy, a nie tworzyć nową. Pisz po polsku, zwięźle.`);
  const test = await ask(apiKey, `Jesteś Agentem Testów A/B Fiszy. ${DNA}\n${context}\nKreacje:\n${creative}\nLandingi:\n${landing}\nWybierz jeden test na teraz: wyłącznie jedna zmienna, stałe elementy, hipoteza, A/B, główna metryka, minimalny próg obserwacji i decyzja: skaluj/powtórz/wyłącz. Pisz po polsku, zwięźle.`);
  const performance = await ask(apiKey, `Jesteś Agentem Performance Fiszy. ${DNA}\n${DATA_RULE}\n${context}\nPlan A/B:\n${test}\nPrzygotuj plan uruchomienia bez samodzielnego wydawania pieniędzy: kanał, grupa, format, zdarzenia do śledzenia, parametry UTM, metryka decyzji oraz trzy alarmy. Pisz po polsku, zwięźle.`);
  const analyst = await ask(apiKey, `Jesteś Agentem Analityk Fiszy. ${DNA}\n${DATA_RULE}\n${context}\nPlan Performance:\n${performance}\nZaprojektuj jeden dzienny raport Growth: koszt, wejścia landing, zapis, konto, płatne wejście, CAC uczestnika, największy drop, najlepszy kanał i jedna decyzja na jutro. Podaj definicje zdarzeń oraz kiedy raport ma powiedzieć 'brak danych'. Pisz po polsku, zwięźle.`);
  const lifecycle = await ask(apiKey, `Jesteś Agentem Lifecycle Fiszy. ${DNA}\n${context}\nJeśli aukcja i data są podane, zaplanuj komunikację T-5 dni, T-3 dni, T-24h, T-6h, T-1h, T-10min, live i po aukcji. Jeśli brakuje danych, podaj dokładnie czego potrzebujesz. Dodaj zasady segmentacji: zapisani, odwiedzający landing, opłacone wejście i przegrani. Pisz po polsku, zwięźle.`);
  return [
    { agent: "Social Listening", content: social },
    { agent: "Community", content: community },
    { agent: "Creative", content: creative },
    { agent: "Landing Page", content: landing },
    { agent: "A/B", content: test },
    { agent: "Performance", content: performance },
    { agent: "Analityk", content: analyst },
    { agent: "Lifecycle", content: lifecycle },
  ];
}

async function ask(apiKey: string, input: string) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: process.env.FISZY_MARKETING_MODEL?.trim() || "gpt-5-mini", input, max_output_tokens: 900 }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Silnik agentów nie odpowiedział. Sprawdź klucz i FISZY_MARKETING_MODEL.");
  const payload = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
  const output = payload.output_text ?? payload.output?.flatMap((item) => item.content ?? []).map((item) => item.text ?? "").join("\n");
  if (!output?.trim()) throw new Error("Silnik agentów zwrócił pustą odpowiedź.");
  return output.trim();
}
