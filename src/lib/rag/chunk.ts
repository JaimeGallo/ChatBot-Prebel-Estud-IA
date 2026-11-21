export type TextChunk = {
  section: string | null;
  content: string;
  tokenEstimate: number;
};

const CORPUS_FILES = [
  {
    source: "Vinculación_y_nomina_20260310.md",
    title: "Vinculación y Nómina",
  },
  {
    source: "Creditos_Prebel_20260310.md",
    title: "Créditos Prebel",
  },
  {
    source: "Auxilios_y_beneficios_Prebel_20260310.md",
    title: "Auxilios y Beneficios",
  },
] as const;

export { CORPUS_FILES };

export function chunkMarkdown(markdown: string, maxChars = 900): TextChunk[] {
  const cleaned = markdown
    .replace(/<\/?u>/gi, "")
    .replace(/<table[\s\S]*?<\/table>/gi, (table) =>
      table
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/?(tr|td|th|thead|tbody|table)[^>]*>/gi, (tag) => {
          if (/<\/tr/i.test(tag)) return "\n";
          if (/<\/t[dh]/i.test(tag)) return " | ";
          return " ";
        })
        .replace(/<[^>]+>/g, " ")
        .replace(/\|(\s*\|)+/g, "|")
        .replace(/[ \t]+/g, " ")
        .trim()
    )
    .replace(/\r\n/g, "\n");

  const sections = cleaned.split(/(?=^#{1,3}\s)/m).filter((s) => s.trim());
  const chunks: TextChunk[] = [];

  for (const section of sections) {
    const lines = section.trim().split("\n");
    const headingMatch = lines[0]?.match(/^#{1,3}\s+(.+)/);
    const sectionTitle = headingMatch ? headingMatch[1].trim() : null;
    const body = section.trim();

    if (body.length <= maxChars) {
      chunks.push({
        section: sectionTitle,
        content: body,
        tokenEstimate: Math.ceil(body.length / 4),
      });
      continue;
    }

    // Split by paragraphs / list blocks
    const parts = body.split(/\n{2,}/);
    let buffer = "";
    for (const part of parts) {
      if ((buffer + "\n\n" + part).length > maxChars && buffer) {
        chunks.push({
          section: sectionTitle,
          content: buffer.trim(),
          tokenEstimate: Math.ceil(buffer.length / 4),
        });
        buffer = part;
      } else {
        buffer = buffer ? `${buffer}\n\n${part}` : part;
      }
    }
    if (buffer.trim()) {
      // Hard-split oversized buffers
      let rest = buffer.trim();
      while (rest.length > maxChars) {
        const slice = rest.slice(0, maxChars);
        const cut = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("\n"), 400);
        const piece = rest.slice(0, cut + 1).trim();
        chunks.push({
          section: sectionTitle,
          content: piece,
          tokenEstimate: Math.ceil(piece.length / 4),
        });
        rest = rest.slice(cut + 1).trim();
      }
      if (rest) {
        chunks.push({
          section: sectionTitle,
          content: rest,
          tokenEstimate: Math.ceil(rest.length / 4),
        });
      }
    }
  }

  return chunks.filter((c) => c.content.length > 40);
}
