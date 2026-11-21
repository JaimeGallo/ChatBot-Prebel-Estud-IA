export type GuardResult =
  | { blocked: false; sanitized: string }
  | { blocked: true; reason: string; sanitized: string };

const INJECTION_PATTERNS: { pattern: RegExp; reason: string }[] = [
  {
    pattern:
      /ignora\s+(todas\s+)?(las\s+)?instrucciones|ignore\s+(all\s+)?(previous\s+)?instructions/i,
    reason: "intento_sobreescribir_instrucciones",
  },
  {
    pattern:
      /revela\s+(el\s+)?(system\s+)?prompt|show\s+(me\s+)?(the\s+)?system\s+prompt|print\s+your\s+instructions/i,
    reason: "exfiltracion_system_prompt",
  },
  {
    pattern:
      /act[uú]a\s+como|you\s+are\s+now|pretend\s+to\s+be|DAN\s+mode|jailbreak/i,
    reason: "role_hijack",
  },
  {
    pattern:
      /<\s*\/?\s*system\s*>|\[INST\]|<<SYS>>|###\s*System/i,
    reason: "delimitadores_sistema",
  },
  {
    pattern:
      /api[_-]?key|secret[_-]?key|DATABASE_URL|Bearer\s+[A-Za-z0-9._-]{20,}/i,
    reason: "exfiltracion_secretos",
  },
  {
    pattern:
      /desactiva\s+(tus\s+)?filtros|bypass\s+(safety|filter|guard)/i,
    reason: "bypass_seguridad",
  },
];

const MAX_INPUT_CHARS = 2000;

export function sanitizeUserInput(raw: string): string {
  return raw
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_INPUT_CHARS);
}

export function checkPromptInjection(raw: string): GuardResult {
  const sanitized = sanitizeUserInput(raw);

  if (!sanitized) {
    return { blocked: true, reason: "mensaje_vacio", sanitized };
  }

  for (const { pattern, reason } of INJECTION_PATTERNS) {
    if (pattern.test(sanitized)) {
      return { blocked: true, reason, sanitized };
    }
  }

  // High ratio of instruction-like English/Spanish meta commands mixed with code fences
  const fenceCount = (sanitized.match(/```/g) || []).length;
  if (fenceCount >= 4 && /system|prompt|instruction/i.test(sanitized)) {
    return { blocked: true, reason: "payload_sospechoso", sanitized };
  }

  return { blocked: false, sanitized };
}

export const BLOCKED_USER_MESSAGE =
  "No puedo procesar ese mensaje. Reformúlalo como una consulta sobre auxilios, créditos, vinculación o nómina de Prebel.";

export const OUT_OF_SCOPE_MESSAGE =
  "Lo siento, esa información no está disponible en este momento, ya que mi conocimiento se limita únicamente a los documentos cargados.";

export const DISCLAIMER =
  "Este chatbot de Gestión Humana funciona con inteligencia artificial y puede cometer errores. Te recomendamos validar la información o resolver cualquier duda con Stefanny Pulgarín, Analista de Bienestar y RSE, o Michell Román, Asistente Gestión Humana.";
