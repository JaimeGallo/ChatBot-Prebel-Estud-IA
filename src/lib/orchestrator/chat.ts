import {
  checkPromptInjection,
  BLOCKED_USER_MESSAGE,
  OUT_OF_SCOPE_MESSAGE,
  DISCLAIMER,
} from "@/lib/security/guardrails";
import { classifyAndClarify, generateGroundedAnswer } from "@/lib/llm/groq";
import { retrieveChunks, formatContext } from "@/lib/rag/retrieve";
import {
  getOrCreateSession,
  logMessage,
  logEvent,
} from "@/lib/telemetry";

export type ChatRequest = {
  message: string;
  sessionId?: string;
  channel: "web" | "whatsapp";
  externalId?: string;
  history?: { role: "user" | "assistant"; content: string }[];
};

export type ChatResponse = {
  sessionId: string;
  reply: string;
  topic: string;
  grounded: boolean;
  clarified: boolean;
  blocked: boolean;
  options?: string[];
  sources?: { source: string; section: string | null; score: number }[];
  latencyMs: number;
};

function ensureDisclaimer(text: string): string {
  if (text.includes("Stefanny Pulgarín") || text.includes("Michell Román")) {
    return text;
  }
  if (text.includes(OUT_OF_SCOPE_MESSAGE)) {
    return text;
  }
  return `${text.trim()}\n\n${DISCLAIMER}`;
}

function formatClarification(
  question: string,
  options?: string[]
): string {
  const opts = options?.length
    ? "\n\n" + options.map((o, i) => `${i + 1}. ${o}`).join("\n")
    : "";
  return `Entiendo tu duda. Para enfocarte mejor la respuesta: ${question}${opts}\n\nRecuerda: este asistente responde únicamente con base en los documentos cargados.`;
}

export async function handleChat(req: ChatRequest): Promise<ChatResponse> {
  const started = Date.now();
  const session = await getOrCreateSession({
    channel: req.channel,
    sessionId: req.sessionId,
    externalId: req.externalId,
  });

  const guard = checkPromptInjection(req.message);

  await logMessage({
    sessionId: session.id,
    role: "user",
    content: guard.sanitized || req.message,
    blocked: guard.blocked,
  });

  if (guard.blocked) {
    await logEvent({
      sessionId: session.id,
      type: "prompt_injection_blocked",
      channel: req.channel,
      payload: { reason: guard.reason },
    });
    const reply = BLOCKED_USER_MESSAGE;
    await logMessage({
      sessionId: session.id,
      role: "assistant",
      content: reply,
      blocked: true,
      grounded: false,
      latencyMs: Date.now() - started,
    });
    return {
      sessionId: session.id,
      reply,
      topic: "blocked",
      grounded: false,
      clarified: false,
      blocked: true,
      latencyMs: Date.now() - started,
    };
  }

  const classification = await classifyAndClarify(
    guard.sanitized,
    req.history ?? []
  );

  if (classification.needs_clarification) {
    const reply = formatClarification(
      classification.clarification_question ||
        "¿Puedes precisar un poco más tu consulta?",
      classification.options
    );
    await logMessage({
      sessionId: session.id,
      role: "assistant",
      content: reply,
      topic: classification.topic,
      clarified: true,
      grounded: true,
      latencyMs: Date.now() - started,
    });
    await logEvent({
      sessionId: session.id,
      type: "clarification",
      topic: classification.topic,
      channel: req.channel,
    });
    return {
      sessionId: session.id,
      reply,
      topic: classification.topic,
      grounded: true,
      clarified: true,
      blocked: false,
      options: classification.options,
      latencyMs: Date.now() - started,
    };
  }

  if (classification.topic === "fuera_alcance") {
    const reply = OUT_OF_SCOPE_MESSAGE;
    await logMessage({
      sessionId: session.id,
      role: "assistant",
      content: reply,
      topic: "fuera_alcance",
      grounded: false,
      latencyMs: Date.now() - started,
    });
    await logEvent({
      sessionId: session.id,
      type: "ungrounded_answer",
      topic: "fuera_alcance",
      channel: req.channel,
      payload: { question: guard.sanitized },
    });
    return {
      sessionId: session.id,
      reply,
      topic: "fuera_alcance",
      grounded: false,
      clarified: false,
      blocked: false,
      latencyMs: Date.now() - started,
    };
  }

  let chunks: Awaited<ReturnType<typeof retrieveChunks>> = [];
  try {
    chunks = await retrieveChunks(guard.sanitized, classification.topic, 5);
  } catch (err) {
    console.error("RAG retrieve failed:", err);
  }

  if (!chunks.length) {
    const reply = OUT_OF_SCOPE_MESSAGE;
    await logMessage({
      sessionId: session.id,
      role: "assistant",
      content: reply,
      topic: classification.topic,
      grounded: false,
      latencyMs: Date.now() - started,
    });
    await logEvent({
      sessionId: session.id,
      type: "ungrounded_answer",
      topic: classification.topic,
      channel: req.channel,
      payload: { question: guard.sanitized },
    });
    return {
      sessionId: session.id,
      reply,
      topic: classification.topic,
      grounded: false,
      clarified: false,
      blocked: false,
      latencyMs: Date.now() - started,
    };
  }

  const context = formatContext(chunks);
  let answer: string;
  try {
    answer = await generateGroundedAnswer(guard.sanitized, context);
  } catch (err) {
    console.error("LLM failed:", err);
    answer = OUT_OF_SCOPE_MESSAGE;
  }

  // Soft grounding check: if model drifted away from out-of-scope phrase incorrectly with empty-ish
  const looksUnavailable = answer.includes(
    "no está disponible en este momento"
  );
  const grounded = !looksUnavailable;
  const reply = ensureDisclaimer(answer);

  await logMessage({
    sessionId: session.id,
    role: "assistant",
    content: reply,
    topic: classification.topic,
    grounded,
    latencyMs: Date.now() - started,
    metadata: {
      sources: chunks.map((c) => ({
        source: c.source,
        section: c.section,
        score: c.score,
      })),
    },
  });

  await logEvent({
    sessionId: session.id,
    type: grounded ? "grounded_answer" : "ungrounded_answer",
    topic: classification.topic,
    channel: req.channel,
    value: Date.now() - started,
    payload: { question: guard.sanitized },
  });

  return {
    sessionId: session.id,
    reply,
    topic: classification.topic,
    grounded,
    clarified: false,
    blocked: false,
    sources: chunks.map((c) => ({
      source: c.source,
      section: c.section,
      score: c.score,
    })),
    latencyMs: Date.now() - started,
  };
}
