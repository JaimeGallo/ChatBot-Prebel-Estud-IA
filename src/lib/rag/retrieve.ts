import { neon } from "@neondatabase/serverless";
import { queryTerms, scoreText } from "./embed";

export type RetrievedChunk = {
  id: string;
  source: string;
  section: string | null;
  content: string;
  score: number;
};

const TOPIC_SOURCE: Record<string, string | null> = {
  vinculacion_nomina: "Vinculación_y_nomina_20260310.md",
  creditos: "Creditos_Prebel_20260310.md",
  auxilios_beneficios: "Auxilios_y_beneficios_Prebel_20260310.md",
  fuera_alcance: null,
};

const MIN_SCORE = 0.15;

export async function retrieveChunks(
  query: string,
  topic?: string,
  topK = 5
): Promise<RetrievedChunk[]> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const sql = neon(url);
  const sourceFilter = topic ? TOPIC_SOURCE[topic] ?? null : null;
  const terms = queryTerms(query);

  let rows: {
    id: string;
    source: string;
    section: string | null;
    content: string;
  }[];

  if (sourceFilter) {
    rows = (await sql`
      SELECT id, source, section, content
      FROM chunks
      WHERE source = ${sourceFilter}
    `) as typeof rows;
  } else {
    rows = (await sql`
      SELECT id, source, section, content
      FROM chunks
    `) as typeof rows;
  }

  if (!terms.length) {
    return rows.slice(0, topK).map((r) => ({ ...r, score: 0.2 }));
  }

  // Prefer chunks matching at least one term via SQL prefilter when possible
  const primary = terms[0];
  const pattern = `%${primary}%`;

  let candidates = rows;
  if (rows.length > 80) {
    if (sourceFilter) {
      candidates = (await sql`
        SELECT id, source, section, content
        FROM chunks
        WHERE source = ${sourceFilter}
          AND (
            lower(content) LIKE ${pattern}
            OR lower(coalesce(section, '')) LIKE ${pattern}
          )
        LIMIT 60
      `) as typeof rows;
    } else {
      candidates = (await sql`
        SELECT id, source, section, content
        FROM chunks
        WHERE lower(content) LIKE ${pattern}
           OR lower(coalesce(section, '')) LIKE ${pattern}
        LIMIT 60
      `) as typeof rows;
    }
    if (!candidates.length) candidates = rows;
  }

  return candidates
    .map((r) => ({
      ...r,
      score: scoreText(`${r.section ?? ""} ${r.content}`, terms),
    }))
    .filter((r) => r.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

export function formatContext(chunks: RetrievedChunk[]): string {
  if (!chunks.length) return "";
  return chunks
    .map(
      (c, i) =>
        `[${i + 1}] Fuente: ${c.source}${c.section ? ` → ${c.section}` : ""}\n${c.content}`
    )
    .join("\n\n---\n\n");
}

export { MIN_SCORE };
