import { eq, gte, desc, and } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

const { sessions, messages, events } = schema;

export async function getOrCreateSession(opts: {
  channel: "web" | "whatsapp";
  sessionId?: string;
  externalId?: string;
  metadata?: Record<string, unknown>;
}) {
  const db = getDb();

  if (opts.sessionId) {
    const existing = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, opts.sessionId))
      .limit(1);
    if (existing[0]) {
      await db
        .update(sessions)
        .set({ lastActiveAt: new Date() })
        .where(eq(sessions.id, opts.sessionId));
      return existing[0];
    }
  }

  if (opts.externalId) {
    const byExt = await db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.externalId, opts.externalId),
          eq(sessions.channel, opts.channel)
        )
      )
      .limit(1);
    if (byExt[0]) {
      await db
        .update(sessions)
        .set({ lastActiveAt: new Date() })
        .where(eq(sessions.id, byExt[0].id));
      return byExt[0];
    }
  }

  const [created] = await db
    .insert(sessions)
    .values({
      channel: opts.channel,
      externalId: opts.externalId,
      metadata: opts.metadata ?? {},
    })
    .returning();
  return created;
}

export async function logMessage(input: {
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  topic?: string | null;
  grounded?: boolean | null;
  clarified?: boolean;
  blocked?: boolean;
  latencyMs?: number;
  metadata?: Record<string, unknown>;
}) {
  const db = getDb();
  const [row] = await db
    .insert(messages)
    .values({
      sessionId: input.sessionId,
      role: input.role,
      content: input.content,
      topic: input.topic ?? null,
      grounded: input.grounded ?? null,
      clarified: input.clarified ?? false,
      blocked: input.blocked ?? false,
      latencyMs: input.latencyMs,
      metadata: input.metadata ?? {},
    })
    .returning();
  return row;
}

/** Last N user/assistant turns for follow-ups (e.g. WhatsApp "1" after clarification). */
export async function getRecentMessages(
  sessionId: string,
  limit = 8
): Promise<{ role: "user" | "assistant"; content: string }[]> {
  const db = getDb();
  const rows = await db
    .select({
      role: messages.role,
      content: messages.content,
    })
    .from(messages)
    .where(eq(messages.sessionId, sessionId))
    .orderBy(desc(messages.createdAt))
    .limit(limit);

  return rows
    .reverse()
    .filter(
      (r): r is { role: "user" | "assistant"; content: string } =>
        r.role === "user" || r.role === "assistant"
    );
}

export async function logEvent(input: {
  sessionId?: string;
  type: string;
  topic?: string | null;
  channel?: string;
  value?: number;
  payload?: Record<string, unknown>;
}) {
  const db = getDb();
  await db.insert(events).values({
    sessionId: input.sessionId,
    type: input.type,
    topic: input.topic ?? null,
    channel: input.channel,
    value: input.value,
    payload: input.payload ?? {},
  });
}

export type DashboardMetrics = {
  totalQueries: number;
  byChannel: { channel: string; count: number }[];
  byTopic: { topic: string; count: number }[];
  groundedRate: number;
  clarificationRate: number;
  blockedCount: number;
  outOfScopeCount: number;
  latencyP50: number | null;
  latencyP95: number | null;
  uncoveredQuestions: { content: string; createdAt: string }[];
  dailyVolume: { day: string; count: number }[];
};

export async function getDashboardMetrics(
  days = 30
): Promise<DashboardMetrics> {
  const db = getDb();
  const since = new Date();
  since.setDate(since.getDate() - days);

  const userMessages = await db
    .select()
    .from(messages)
    .where(
      and(eq(messages.role, "user"), gte(messages.createdAt, since))
    );

  const assistantMessages = await db
    .select()
    .from(messages)
    .where(
      and(eq(messages.role, "assistant"), gte(messages.createdAt, since))
    );

  const sessionRows = await db
    .select()
    .from(sessions)
    .where(gte(sessions.createdAt, since));

  const channelMap = new Map<string, number>();
  for (const s of sessionRows) {
    channelMap.set(s.channel, (channelMap.get(s.channel) ?? 0) + 1);
  }

  // Better: count user messages by joining session channel
  const byChannelMap = new Map<string, number>();
  const sessionChannel = new Map(sessionRows.map((s) => [s.id, s.channel]));
  // load all sessions referenced
  const allSessionIds = [...new Set(userMessages.map((m) => m.sessionId))];
  if (allSessionIds.length) {
    const sess = await db.select().from(sessions);
    for (const s of sess) sessionChannel.set(s.id, s.channel);
  }
  for (const m of userMessages) {
    const ch = sessionChannel.get(m.sessionId) ?? "unknown";
    byChannelMap.set(ch, (byChannelMap.get(ch) ?? 0) + 1);
  }

  const topicMap = new Map<string, number>();
  for (const m of assistantMessages) {
    const t = m.topic ?? "sin_tema";
    topicMap.set(t, (topicMap.get(t) ?? 0) + 1);
  }

  const grounded = assistantMessages.filter((m) => m.grounded === true).length;
  const clarified = assistantMessages.filter((m) => m.clarified).length;
  const blocked = userMessages.filter((m) => m.blocked).length;
  const outOfScope = assistantMessages.filter(
    (m) => m.topic === "fuera_alcance" || m.grounded === false
  ).length;

  const latencies = assistantMessages
    .map((m) => m.latencyMs)
    .filter((n): n is number => typeof n === "number")
    .sort((a, b) => a - b);

  const percentile = (arr: number[], p: number) => {
    if (!arr.length) return null;
    const idx = Math.ceil((p / 100) * arr.length) - 1;
    return arr[Math.max(0, idx)];
  };

  const uncovered = await db
    .select({
      content: messages.content,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(
      and(
        eq(messages.role, "user"),
        gte(messages.createdAt, since),
        eq(messages.blocked, false)
      )
    )
    .orderBy(desc(messages.createdAt))
    .limit(50);

  // Pair with non-grounded assistant replies — approximate via events
  const uncoveredEvents = await db
    .select()
    .from(events)
    .where(
      and(
        eq(events.type, "ungrounded_answer"),
        gte(events.createdAt, since)
      )
    )
    .orderBy(desc(events.createdAt))
    .limit(20);

  const uncoveredQuestions = uncoveredEvents.map((e) => ({
    content: String((e.payload as { question?: string })?.question ?? "—"),
    createdAt: e.createdAt.toISOString(),
  }));

  if (!uncoveredQuestions.length) {
    // fallback: recent user msgs when assistant grounded=false nearby
    for (const u of uncovered.slice(0, 10)) {
      uncoveredQuestions.push({
        content: u.content.slice(0, 200),
        createdAt: u.createdAt.toISOString(),
      });
    }
  }

  const dayMap = new Map<string, number>();
  for (const m of userMessages) {
    const day = m.createdAt.toISOString().slice(0, 10);
    dayMap.set(day, (dayMap.get(day) ?? 0) + 1);
  }

  const totalAssistant = assistantMessages.length || 1;

  return {
    totalQueries: userMessages.length,
    byChannel: [...byChannelMap.entries()].map(([channel, count]) => ({
      channel,
      count,
    })),
    byTopic: [...topicMap.entries()]
      .map(([topic, count]) => ({ topic, count }))
      .sort((a, b) => b.count - a.count),
    groundedRate: grounded / totalAssistant,
    clarificationRate: clarified / totalAssistant,
    blockedCount: blocked,
    outOfScopeCount: outOfScope,
    latencyP50: percentile(latencies, 50),
    latencyP95: percentile(latencies, 95),
    uncoveredQuestions: uncoveredQuestions.slice(0, 15),
    dailyVolume: [...dayMap.entries()]
      .map(([day, count]) => ({ day, count }))
      .sort((a, b) => a.day.localeCompare(b.day)),
  };
}
