import { createGroq } from "@ai-sdk/groq";
import { generateText, generateObject } from "ai";
import { z } from "zod";
import {
  SYSTEM_PROMPT,
  CLARIFY_SYSTEM,
  buildAnswerPrompt,
  type ClarifyResult,
} from "./prompts";

const MODEL = "llama-3.3-70b-versatile";

function getGroq() {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY is not set");
  return createGroq({ apiKey: key });
}

const clarifySchema = z.object({
  topic: z.enum([
    "vinculacion_nomina",
    "creditos",
    "auxilios_beneficios",
    "fuera_alcance",
  ]),
  needs_clarification: z.boolean(),
  clarification_question: z.string().optional(),
  options: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1),
});

export async function classifyAndClarify(
  question: string,
  history: { role: "user" | "assistant"; content: string }[] = []
): Promise<ClarifyResult> {
  const groq = getGroq();
  try {
    const { object } = await generateObject({
      model: groq(MODEL),
      schema: clarifySchema,
      system: CLARIFY_SYSTEM,
      messages: [
        ...history.slice(-4).map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
        {
          role: "user",
          content: `Clasifica esta consulta:\n"${question}"`,
        },
      ],
      temperature: 0,
    });
    return object;
  } catch {
    // Heuristic fallback if structured output fails
    const q = question.toLowerCase();
    if (/cr[eé]dito/.test(q) && !/educativ|salud|vivienda|mascota/.test(q)) {
      return {
        topic: "creditos",
        needs_clarification: true,
        clarification_question:
          "¿Te refieres a créditos educativos, de salud, para vivienda o calamidad de mascotas?",
        options: [
          "Crédito educativo / computador",
          "Crédito de salud",
          "Crédito de vivienda",
          "Calamidad de mascotas",
        ],
        confidence: 0.6,
      };
    }
    if (/auxilio|beneficio/.test(q) && q.split(/\s+/).length < 6) {
      return {
        topic: "auxilios_beneficios",
        needs_clarification: true,
        clarification_question:
          "¿Sobre qué auxilio o beneficio necesitas información?",
        options: [
          "Auxilio educativo",
          "Auxilio visual u odontológico",
          "Alimentación",
          "Otros beneficios",
        ],
        confidence: 0.55,
      };
    }
    let topic: ClarifyResult["topic"] = "fuera_alcance";
    if (/cesant|n[oó]mina|certificado|vacacion|vincul/.test(q)) {
      topic = "vinculacion_nomina";
    } else if (/cr[eé]dito/.test(q)) {
      topic = "creditos";
    } else if (/auxilio|beneficio|emi|seguro/.test(q)) {
      topic = "auxilios_beneficios";
    }
    return {
      topic,
      needs_clarification: false,
      confidence: 0.4,
    };
  }
}

export async function generateGroundedAnswer(
  question: string,
  context: string
): Promise<string> {
  const groq = getGroq();
  const { text } = await generateText({
    model: groq(MODEL),
    system: SYSTEM_PROMPT,
    prompt: buildAnswerPrompt(context, question),
    temperature: 0.2,
    maxTokens: 1200,
  });
  return text.trim();
}
