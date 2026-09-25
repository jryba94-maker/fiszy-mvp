export const BRAND_DESCRIPTION =
  "Fiszy to platforma zakupowa oparta na aukcjach holenderskich, w których cena produktu spada w czasie, a pierwsza osoba, która zdecyduje się kupić po aktualnej cenie, wygrywa aukcję.";

export function serializeJsonLd(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
