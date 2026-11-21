import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  boolean,
  real,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

export const documents = pgTable("documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  source: text("source").notNull().unique(),
  title: text("title").notNull(),
  contentHash: text("content_hash").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const chunks = pgTable(
  "chunks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    section: text("section"),
    content: text("content").notNull(),
    tokenEstimate: integer("token_estimate").default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("chunks_source_idx").on(t.source)]
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    channel: text("channel").notNull(), // web | whatsapp
    externalId: text("external_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastActiveAt: timestamp("last_active_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("sessions_channel_idx").on(t.channel),
    index("sessions_external_idx").on(t.externalId),
  ]
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    role: text("role").notNull(), // user | assistant | system
    content: text("content").notNull(),
    topic: text("topic"),
    grounded: boolean("grounded"),
    clarified: boolean("clarified").default(false),
    blocked: boolean("blocked").default(false),
    latencyMs: integer("latency_ms"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("messages_session_idx").on(t.sessionId),
    index("messages_topic_idx").on(t.topic),
    index("messages_created_idx").on(t.createdAt),
  ]
);

export const events = pgTable(
  "events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sessionId: uuid("session_id").references(() => sessions.id, {
      onDelete: "set null",
    }),
    type: text("type").notNull(),
    topic: text("topic"),
    channel: text("channel"),
    value: real("value"),
    payload: jsonb("payload").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    index("events_type_idx").on(t.type),
    index("events_created_idx").on(t.createdAt),
    index("events_topic_idx").on(t.topic),
  ]
);

export type Document = typeof documents.$inferSelect;
export type Chunk = typeof chunks.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Event = typeof events.$inferSelect;
