import { neon } from "@neondatabase/serverless";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required");
  }

  const sql = neon(url);

  await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`;

  await sql`
    CREATE TABLE IF NOT EXISTS documents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      source TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS chunks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      source TEXT NOT NULL,
      section TEXT,
      content TEXT NOT NULL,
      token_estimate INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`ALTER TABLE chunks DROP COLUMN IF EXISTS embedding`;
  await sql`CREATE INDEX IF NOT EXISTS chunks_source_idx ON chunks(source)`;

  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      channel TEXT NOT NULL,
      external_id TEXT,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_active_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS sessions_channel_idx ON sessions(channel)`;
  await sql`CREATE INDEX IF NOT EXISTS sessions_external_idx ON sessions(external_id)`;

  await sql`
    CREATE TABLE IF NOT EXISTS messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      topic TEXT,
      grounded BOOLEAN,
      clarified BOOLEAN DEFAULT false,
      blocked BOOLEAN DEFAULT false,
      latency_ms INTEGER,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS messages_session_idx ON messages(session_id)`;
  await sql`CREATE INDEX IF NOT EXISTS messages_topic_idx ON messages(topic)`;
  await sql`CREATE INDEX IF NOT EXISTS messages_created_idx ON messages(created_at)`;

  await sql`
    CREATE TABLE IF NOT EXISTS events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
      type TEXT NOT NULL,
      topic TEXT,
      channel TEXT,
      value REAL,
      payload JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;

  await sql`CREATE INDEX IF NOT EXISTS events_type_idx ON events(type)`;
  await sql`CREATE INDEX IF NOT EXISTS events_created_idx ON events(created_at)`;
  await sql`CREATE INDEX IF NOT EXISTS events_topic_idx ON events(topic)`;

  console.log("Migration complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
