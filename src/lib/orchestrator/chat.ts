import {
  checkPromptInjection,
  BLOCKED_USER_MESSAGE,
  OUT_OF_SCOPE_MESSAGE,
  DISCLAIMER,
} from "@/lib/security/guardrails";
import { classifyAndClarify, generateGroundedAnswer } from "@/lib/llm/groq";
import { retrieveChunks, formatContext } from "@/lib/rag/retrieve";
import {
  closeSession,
  getOrCreateSession,
  getRecentMessages,
  logMessage,
  logEvent,
} from "@/lib/telemetry";

const MAIN_MENU = [
  "Vinculación y Nómina",
  "Créditos y Condiciones",
  "Auxilios y Beneficios",
] as const;

const CLARIFY_MARKER = "Para enfocarte mejor la respuesta";
const WELCOME_MARKER = "Puedo ayudarte con:";
const MENU_MARKERS = [CLARIFY_MARKER, WELCOME_MARKER];

const CATEGORY_OPTIONS: Record<(typeof MAIN_MENU)[number], string[]> = {
  "Vinculación y Nómina": [
    "Certificados laborales",
    "Retiro de cesantías",
    "Inclusiones y traslados de EPS",
    "Caja de compensación familiar",
    "Traslado a Colpensiones",
    "Vacaciones",
    "Incapacidades",
  ],
  "Créditos y Condiciones": [
    "Crédito educativo / computador",
    "Crédito de salud",
    "Crédito de vivienda",
    "Calamidad de mascotas",
  ],
  "Auxilios y Beneficios": [
    "Auxilio educativo",
    "Auxilio visual u odontológico",
    "Alimentación",
    "Otros beneficios",
  ],
};

const WELCOME_MESSAGE = `¡Hola! Soy el asistente de Gestión Humana de Prebel. ${WELCOME_MARKER}

${MAIN_MENU.map((c, i) => `${i + 1}. ${c}`).join("\n")}

Escribe tu pregunta o el número de la opción.

Recuerda: este asistente responde únicamente con base en los documentos cargados.`;

const FAREWELL_MESSAGE =
  "¡Con gusto! Si necesitas más detalles, aquí estoy para ayudarte. Que tengas un excelente día.";

const GREETING_WORDS = new Set(
  "hola holi buenos buenas buen dia dias tardes noches hey saludos que tal como estas esta".split(" ")
);
const FAREWELL_TRIGGERS = new Set(
  "gracias chao chau adios hasta bye listo ok okay perfecto".split(" ")
);
const FAREWELL_WORDS = new Set([
  ...FAREWELL_TRIGGERS,
  ..."muchas mil muy por la tu su ayuda amable eso era es todo luego nos vemos info informacion".split(" "),
]);

/** Pure greetings/farewells only — any message with other content goes to the pipeline. */
function detectSmallTalk(text: string): "greeting" | "farewell" | null {
  const words = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z]+/)
    .filter(Boolean);
  if (!words.length || text.includes("?")) return null;
  if (
    words.some((w) => FAREWELL_TRIGGERS.has(w)) &&
    words.every((w) => FAREWELL_WORDS.has(w))
  ) {
    return "farewell";
  }
  if (words.every((w) => GREETING_WORDS.has(w))) return "greeting";
  return null;
}

/** Terms that only exist in Vinculación y Nómina; overrides classifier confusion with credits. */
const NOMINA_ONLY_RE =
  /cesant|\beps\b|colpensiones|vacacion|caja de compensaci|comfama|comfenalco/i;

function topicFromLabel(
  label: string
): "vinculacion_nomina" | "creditos" | "auxilios_beneficios" {
  if (/cr[eé]dito/i.test(label)) return "creditos";
  if (/auxilio|beneficio|alimentaci|seguro|emi\b/i.test(label)) {
    return "auxilios_beneficios";
  }
  return "vinculacion_nomina";
}

/** Map "1"/"2" replies to the option text from the last clarification. */
function resolveClarificationChoice(
  message: string,
  history: { role: "user" | "assistant"; content: string }[]
): string {
  const trimmed = message.trim();
  const match = /^([1-9])$/.exec(trimmed);
  if (!match) return message;

  // Only menus the bot generated; LLM answers also contain numbered steps.
  const lastAssistant = [...history].reverse().find((m) => m.role === "assistant");
  const lastWithOptions =
    lastAssistant && MENU_MARKERS.some((mk) => lastAssistant.content.includes(mk))
      ? lastAssistant
      : undefined;
  if (!lastWithOptions) return message;

  const options = [
    ...lastWithOptions.content.matchAll(/^\s*(\d+)\.\s+(.+)$/gm),
  ];
  const chosen = options.find((o) => o[1] === match[1]);
  if (!chosen) return message;

  const label = chosen[2].trim();
  return `Necesito información sobre: ${label}`;
}

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
  return `Entiendo tu duda. ${CLARIFY_MARKER}: ${question}${opts}\n\nRecuerda: este asistente responde únicamente con base en los documentos cargados.`;
}

export async function handleChat(req: ChatRequest): Promise<ChatResponse> {
  const started = Date.now();
  const session = await getOrCreateSession({
    channel: req.channel,
    sessionId: req.sessionId,
    externalId: req.externalId,
  });

  const history =
    req.history?.length
      ? req.history
      : await getRecentMessages(session.id, 8);

  const resolvedMessage = resolveClarificationChoice(req.message, history);
  const pickedClarificationOption =
    resolvedMessage.trim() !== req.message.trim();
  const guard = checkPromptInjection(resolvedMessage);

  await logMessage({
    sessionId: session.id,
    role: "user",
    content: guard.sanitized || resolvedMessage,
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

  const smallTalk = detectSmallTalk(guard.sanitized);
  if (smallTalk) {
    const reply = smallTalk === "greeting" ? WELCOME_MESSAGE : FAREWELL_MESSAGE;
    await logMessage({
      sessionId: session.id,
      role: "assistant",
      content: reply,
      topic: "conversacion",
      latencyMs: Date.now() - started,
    });
    if (smallTalk === "farewell") {
      await closeSession(session.id, "farewell");
      await logEvent({
        sessionId: session.id,
        type: "session_closed",
        channel: req.channel,
        payload: { reason: "farewell" },
      });
    }
    return {
      sessionId: session.id,
      reply,
      topic: "conversacion",
      grounded: true,
      clarified: false,
      blocked: false,
      options: smallTalk === "greeting" ? [...MAIN_MENU] : undefined,
      latencyMs: Date.now() - started,
    };
  }

  const classification = await classifyAndClarify(guard.sanitized, history);

  // User already chose 1/2/3… or an option label from a prior menu — answer, don't re-ask.
  const choseListedOption =
    pickedClarificationOption ||
    history.some(
      (m) =>
        m.role === "assistant" &&
        /^\s*\d+\.\s+.+/m.test(m.content) &&
        [...m.content.matchAll(/^\s*\d+\.\s+(.+)$/gm)].some(
          (o) =>
            o[1].trim().toLowerCase() === guard.sanitized.trim().toLowerCase()
        )
    );

  if (NOMINA_ONLY_RE.test(guard.sanitized)) {
    classification.topic = "vinculacion_nomina";
  }

  const pickedMainCategory = MAIN_MENU.find((c) =>
    guard.sanitized.endsWith(c)
  );

  if (pickedMainCategory) {
    classification.topic = topicFromLabel(pickedMainCategory);
    classification.needs_clarification = true;
    classification.clarification_question = `¿Sobre qué tema de ${pickedMainCategory.toLowerCase()} necesitas información?`;
    classification.options = CATEGORY_OPTIONS[pickedMainCategory];
  } else if (choseListedOption) {
    classification.needs_clarification = false;
    if (
      classification.topic === "fuera_alcance" ||
      classification.confidence < 0.5
    ) {
      classification.topic = topicFromLabel(guard.sanitized);
    }
  }

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
    if (!chunks.length) {
      // Classifier may have picked the wrong document; search the whole corpus.
      chunks = await retrieveChunks(guard.sanitized, undefined, 5);
    }
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
    const reply =
      "Tuvimos un problema técnico al generar la respuesta (servicio de IA). Intenta de nuevo en un momento.";
    await logMessage({
      sessionId: session.id,
      role: "assistant",
      content: reply,
      topic: classification.topic,
      grounded: false,
      latencyMs: Date.now() - started,
      metadata: { llm_error: String(err) },
    });
    await logEvent({
      sessionId: session.id,
      type: "llm_error",
      topic: classification.topic,
      channel: req.channel,
      payload: { message: String(err) },
    });
    return {
      sessionId: session.id,
      reply,
      topic: classification.topic,
      grounded: false,
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
