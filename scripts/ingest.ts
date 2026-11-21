import { createHash } from "crypto";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { neon } from "@neondatabase/serverless";
import { CORPUS_FILES, chunkMarkdown } from "../src/lib/rag/chunk";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");

  const sql = neon(url);
  const docsDir = join(process.cwd(), "docs");

  console.log("Ensuring schema...");
  await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`;

  for (const doc of CORPUS_FILES) {
    const path = join(docsDir, doc.source);
    if (!existsSync(path)) {
      console.warn(`Missing: ${path}`);
      continue;
    }

    const raw = readFileSync(path, "utf-8");
    const hash = createHash("sha256").update(raw).digest("hex");
    const parts = chunkMarkdown(raw);
    console.log(`\n${doc.source}: ${parts.length} chunks`);

    const existing = await sql`
      SELECT id, content_hash FROM documents WHERE source = ${doc.source}
    `;

    if (
      existing[0] &&
      (existing[0] as { content_hash: string }).content_hash === hash
    ) {
      console.log("  unchanged, skipping");
      continue;
    }

    if (existing[0]) {
      const id = (existing[0] as { id: string }).id;
      await sql`DELETE FROM chunks WHERE document_id = ${id}`;
      await sql`
        UPDATE documents
        SET content_hash = ${hash}, title = ${doc.title}, updated_at = now()
        WHERE id = ${id}
      `;
    } else {
      await sql`
        INSERT INTO documents (source, title, content_hash)
        VALUES (${doc.source}, ${doc.title}, ${hash})
      `;
    }

    const docRow = await sql`SELECT id FROM documents WHERE source = ${doc.source}`;
    const documentId = (docRow[0] as { id: string }).id;

    for (const chunk of parts) {
      await sql`
        INSERT INTO chunks (document_id, source, section, content, token_estimate)
        VALUES (
          ${documentId},
          ${doc.source},
          ${chunk.section},
          ${chunk.content},
          ${chunk.tokenEstimate}
        )
      `;
    }
    console.log(`  done: ${parts.length} chunks indexed`);
  }

  console.log("\nIngest complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
