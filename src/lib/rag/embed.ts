/** Lightweight lexical scoring — no external embedding model required (Vercel-friendly). */

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9áéíóúñü]+/i)
    .map((w) => w.trim())
    .filter((w) => w.length > 2);
}

const STOP = new Set([
  "para",
  "como",
  "que",
  "los",
  "las",
  "del",
  "una",
  "unos",
  "unas",
  "con",
  "por",
  "sobre",
  "este",
  "esta",
  "estos",
  "estas",
  "the",
  "and",
  "hola",
  "necesito",
  "quiero",
  "puedo",
  "donde",
  "cual",
  "cuales",
  "tiene",
  "tienen",
  "hacer",
  "cuando",
  "debo",
  "puede",
]);

/** Colloquial words → the stem the official documents use (matched by substring). */
const SYNONYMS: Record<string, string> = {
  cambiar: "traslad",
  cambiarme: "traslad",
  cambio: "traslad",
  pasarme: "traslad",
};

export function queryTerms(text: string): string[] {
  return [
    ...new Set(
      tokenize(text)
        .filter((t) => !STOP.has(t))
        .map((t) => SYNONYMS[t] ?? t)
    ),
  ];
}

export function scoreText(content: string, terms: string[]): number {
  if (!terms.length) return 0;
  const hay = tokenize(content).join(" ");
  let hits = 0;
  for (const t of terms) {
    if (hay.includes(t)) hits += 1;
  }
  return hits / terms.length;
}
