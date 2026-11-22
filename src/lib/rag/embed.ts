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
  "pueden",
  "hay",
  "dan",
  "voy",
  "mis",
  "algo",
  "algun",
  "alguna",
  "tengo",
  "ser",
  "soy",
  "ayudan",
  "piden",
  "eso",
  "era",
  "todo",
]);

/** Colloquial words → a stem the official documents use (matched by substring). */
const SYNONYMS: Record<string, string> = {
  cambiar: "traslad",
  cambiarme: "traslad",
  cambio: "traslad",
  pasarme: "traslad",
  casar: "matrimon",
  casarme: "matrimon",
  boda: "matrimon",
  gafas: "visual",
  lentes: "visual",
  anteojos: "visual",
  dentista: "odontolog",
  almuerzo: "aliment",
  comida: "aliment",
  restaurante: "aliment",
  psicologo: "mental",
  psicologa: "mental",
  psicologia: "mental",
  terapia: "mental",
  fallecio: "muerte",
  murio: "muerte",
  fallecimiento: "muerte",
  pensionar: "pension",
  pensionarme: "pension",
  jubilarme: "pension",
  jubilacion: "pension",
  descansar: "vacacion",
  descanso: "vacacion",
  arreglar: "reforma",
  remodelar: "reforma",
  reparar: "reforma",
  apartamento: "vivienda",
  casa: "vivienda",
  prestar: "credit",
  prestan: "credit",
  presten: "credit",
  prestamo: "credit",
  bebe: "nacimiento",
  embarazo: "nacimiento",
  embarazada: "nacimiento",
};

/** Crude Spanish stem so "odontólogo"/"odontológico" or "pensión"/"pensionado" match. */
function stem(term: string): string {
  return term.length > 6 ? term.slice(0, 6) : term;
}

export function queryTerms(text: string): string[] {
  return [
    ...new Set(
      tokenize(text)
        .filter((t) => !STOP.has(t))
        .map((t) => SYNONYMS[t] ?? stem(t))
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
