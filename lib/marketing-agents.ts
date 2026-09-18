import type { MarketingAgent } from "./marketing-agent-storage";

type Input = { brief: string; motive: string; audience: string; cta: string };

const DNA = "DNA Fiszy: minimalizm premium, czerń i biel, fioletowa kula lub oszczędny fioletowy akcent, napięcie, czas i decyzja. Nigdy język SALE, czerwone ceny, dyskont, fałszywa presja ani obietnica najniższej ceny.";

export async function runMarketingAgents(input: Input): Promise<Array<{ agent: MarketingAgent; content: string }>> {
  const apiKey = process.env.FISZY_MARKETING_OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("Brak FISZY_MARKETING_OPENAI_API_KEY. Dodaj sekret środowiskowy, aby uruchomić agentów.");
  const creative = await ask(apiKey, `Jesteś Agentem Creative Fiszy. ${DNA}\nBrief: ${input.brief}\nMotyw: ${input.motive}\nOdbiorca: ${input.audience}\nCTA: ${input.cta}\nPrzygotuj dokładnie 3 warianty do testu. Każdy ma: hook (maks. 8 słów), primary text, CTA, scenariusz rolki 9:16 i jedną hipotezę. Pisz po polsku, konkretnie i zwięźle.`);
  const test = await ask(apiKey, `Jesteś Agentem Testów A/B Fiszy. ${DNA}\nCel: ${input.brief}\nWynik Creative:\n${creative}\nWybierz dwa warianty do pierwszego testu. Zmienna może być tylko jedna. Podaj: pytanie, hipotezę, A/B, elementy stałe, główną metrykę, próg wstępny i regułę skaluj/powtórz/wyłącz. Pisz po polsku i zwięźle.`);
  const performance = await ask(apiKey, `Jesteś Agentem Performance Fiszy. ${DNA}\nCel: ${input.brief}\nPlan testu:\n${test}\nNie masz jeszcze danych z reklam. Przygotuj plan uruchomienia: kanał pierwszego testu, zdarzenia lejka, wskaźnik decyzji i trzy alarmy. Nie rekomenduj zmiany budżetu. Pisz po polsku i zwięźle.`);
  return [{ agent: "Creative", content: creative }, { agent: "A/B", content: test }, { agent: "Performance", content: performance }];
}

async function ask(apiKey: string, input: string) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: process.env.FISZY_MARKETING_MODEL?.trim() || "gpt-5-mini", input, max_output_tokens: 1000 }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Silnik agentów nie odpowiedział. Sprawdź klucz i FISZY_MARKETING_MODEL.");
  const payload = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
  const output = payload.output_text ?? payload.output?.flatMap((item) => item.content ?? []).map((item) => item.text ?? "").join("\n");
  if (!output?.trim()) throw new Error("Silnik agentów zwrócił pustą odpowiedź.");
  return output.trim();
}
