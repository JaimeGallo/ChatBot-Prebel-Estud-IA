/**
 * Retrieval + classification eval over realistic employee phrasings.
 * Usage: npx tsx scripts/eval-retrieval.ts [--classify]
 * Retrieval-only by default (no Groq tokens). --classify adds the LLM topic check (throttled).
 */
import { retrieveChunks } from "../src/lib/rag/retrieve";
import { queryTerms } from "../src/lib/rag/embed";
import { classifyAndClarify } from "../src/lib/llm/groq";

type Case = {
  q: string;
  topic: "vinculacion_nomina" | "creditos" | "auxilios_beneficios" | "fuera_alcance";
  /** Substring (case-insensitive) that must appear in at least one top-5 chunk. */
  expect?: string;
};

const CASES: Case[] = [
  // Vinculación y nómina
  { q: "¿Cómo saco un certificado de trabajo?", topic: "vinculacion_nomina", expect: "certificado" },
  { q: "Necesito una constancia laboral", topic: "vinculacion_nomina", expect: "certificado" },
  { q: "¿Cómo retiro mis cesantías para comprar casa?", topic: "vinculacion_nomina", expect: "promesa de compraventa" },
  { q: "Quiero sacar las cesantías para estudiar", topic: "vinculacion_nomina", expect: "cesant" },
  { q: "¿Cómo afilio a mi esposa a la EPS?", topic: "vinculacion_nomina", expect: "Inclusiones EPS" },
  { q: "¿Puedo meter a mis papás en la EPS?", topic: "vinculacion_nomina", expect: "padres" },
  { q: "¿Cuándo me puedo cambiar de EPS?", topic: "vinculacion_nomina", expect: "5 primeros dias" },
  { q: "Quiero pasarme a otra EPS", topic: "vinculacion_nomina", expect: "Traslados EPS" },
  { q: "¿Cómo inscribo a mi hijo en la caja de compensación?", topic: "vinculacion_nomina", expect: "caja de compensación" },
  { q: "¿Cómo afilio a mi familia a Comfama?", topic: "vinculacion_nomina", expect: "caja de compensación" },
  { q: "Quiero pasarme a Colpensiones", topic: "vinculacion_nomina", expect: "Colpensiones" },
  { q: "¿Cómo cambio de fondo de pensiones?", topic: "vinculacion_nomina", expect: "Colpensiones" },
  { q: "¿Cuántos días de vacaciones tengo?", topic: "vinculacion_nomina", expect: "vacaciones" },
  { q: "¿Cuándo puedo salir a descansar?", topic: "vinculacion_nomina", expect: "vacaciones" },
  { q: "Me incapacitaron, ¿qué hago?", topic: "vinculacion_nomina", expect: "incapacidad" },
  { q: "¿Dónde entrego mi incapacidad médica?", topic: "vinculacion_nomina", expect: "incapacidad" },
  { q: "Necesito la planilla de pago de seguridad social", topic: "vinculacion_nomina", expect: "Seguridad social" },
  // Créditos
  { q: "Háblame de los créditos", topic: "creditos" },
  { q: "¿Me prestan plata para comprar un computador?", topic: "creditos", expect: "computador" },
  { q: "¿Hay préstamo para pagar la universidad?", topic: "creditos", expect: "educación" },
  { q: "Mi perro está enfermo, ¿la empresa me presta?", topic: "creditos", expect: "mascota" },
  { q: "¿Qué requisitos piden para el crédito de mascotas?", topic: "creditos", expect: "mascota" },
  { q: "¿Me pueden prestar para una cirugía?", topic: "creditos", expect: "salud" },
  { q: "¿Hay préstamo para comprar casa?", topic: "creditos", expect: "vivienda" },
  { q: "Quiero arreglar mi apartamento, ¿hay crédito?", topic: "creditos", expect: "reforma" },
  { q: "¿Prestan para pagar el predial?", topic: "creditos", expect: "predial" },
  { q: "¿Cuánto tiempo debo llevar en la empresa para pedir un préstamo?", topic: "creditos", expect: "antigüedad" },
  { q: "¿Cuánto se demoran en aprobar el crédito de vivienda?", topic: "creditos", expect: "tarda" },
  // Auxilios y beneficios
  { q: "¿Qué auxilios ofrece Prebel?", topic: "auxilios_beneficios" },
  { q: "¿Me ayudan con el colegio de mis hijos?", topic: "auxilios_beneficios", expect: "primaria" },
  { q: "¿Cuánto dan por la universidad?", topic: "auxilios_beneficios", expect: "universidad" },
  { q: "¿Me ayudan a pagar las gafas?", topic: "auxilios_beneficios", expect: "visual" },
  { q: "¿Hay auxilio para el odontólogo?", topic: "auxilios_beneficios", expect: "odontol" },
  { q: "¿Dan auxilio de almuerzo?", topic: "auxilios_beneficios", expect: "alimentación" },
  { q: "Me voy a casar, ¿hay algún auxilio?", topic: "auxilios_beneficios", expect: "matrimonio" },
  { q: "Voy a ser papá, ¿qué beneficio tengo?", topic: "auxilios_beneficios", expect: "nacimiento" },
  { q: "¿Tenemos ambulancia o emergencias médicas?", topic: "auxilios_beneficios", expect: "EMI" },
  { q: "¿Tengo seguro de vida?", topic: "auxilios_beneficios", expect: "seguro de vida" },
  { q: "¿Hay apoyo con psicólogo?", topic: "auxilios_beneficios", expect: "salud mental" },
  { q: "Falleció mi mamá, ¿hay auxilio?", topic: "auxilios_beneficios", expect: "muerte de familiares" },
  { q: "Me voy a pensionar, ¿me dan algo?", topic: "auxilios_beneficios", expect: "pensión de vejez" },
  { q: "Soy brigadista, ¿cuánto me pagan?", topic: "auxilios_beneficios", expect: "brigadista" },
  // Fuera de alcance / conversación
  { q: "¿Cuál es el salario mínimo actual?", topic: "fuera_alcance" },
  { q: "Hola", topic: "fuera_alcance" },
  { q: "Gracias, eso era todo", topic: "fuera_alcance" },
  { q: "Chao", topic: "fuera_alcance" },
];

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

async function main() {
  const withClassify = process.argv.includes("--classify");
  let retrievalFails = 0;
  let classifyFails = 0;

  for (const c of CASES) {
    let retrievalOk: boolean | null = null;
    let top = "";
    if (c.expect) {
      const chunks = await retrieveChunks(c.q, c.topic, 5);
      retrievalOk = chunks.some((ch) =>
        norm(`${ch.section ?? ""} ${ch.content}`).includes(norm(c.expect!))
      );
      top = chunks[0]?.section ?? "(sin resultados)";
      if (!retrievalOk) retrievalFails++;
    }

    let topicOk: boolean | null = null;
    let gotTopic = "";
    if (withClassify) {
      const r = await classifyAndClarify(c.q, []);
      gotTopic = r.topic + (r.needs_clarification ? " (aclara)" : "");
      topicOk = r.topic === c.topic;
      if (!topicOk) classifyFails++;
      await new Promise((res) => setTimeout(res, 2500));
    }

    const mark = (v: boolean | null) => (v === null ? "  -" : v ? " OK" : " XX");
    console.log(
      `${mark(retrievalOk)}${mark(topicOk)}  ${c.q}` +
        `  | terms=${queryTerms(c.q).join(",")}` +
        (retrievalOk === false ? `  | top="${top}"` : "") +
        (topicOk === false ? `  | topic=${gotTopic}` : "")
    );
  }

  const withExpect = CASES.filter((c) => c.expect).length;
  console.log(`\nRetrieval: ${withExpect - retrievalFails}/${withExpect} OK`);
  if (withClassify) {
    console.log(`Classification: ${CASES.length - classifyFails}/${CASES.length} OK`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
