# Chatbot Gestión Humana Prebel (EstudIA)

Asistente de **Gestión Humana** para Prebel: consulta de auxilios, créditos, vinculación y nómina con RAG sobre documentos oficiales, canales **Web** y **WhatsApp**, voz (hablar / escuchar), contrapreguntas, anti–prompt injection y **dashboard de telemetría** para toma de decisiones.

Repo: [JaimeGallo/ChatBot-Prebel-Estud-IA](https://github.com/JaimeGallo/ChatBot-Prebel-Estud-IA.git)

## Stack

| Capa | Tecnología |
|------|------------|
| App | Next.js 15 (App Router) → **Vercel** |
| LLM | **Groq** (`llama-3.3-70b-versatile`) |
| Retrieval | Lexical / keyword scoring por tema (corpus FAQ, sin modelo de embeddings) |
| DB | **Neon** Postgres |
| WhatsApp | Meta Cloud API (webhook) |

## Corpus (solo estos 3 archivos)

- `docs/Auxilios_y_beneficios_Prebel_20260310.md`
- `docs/Creditos_Prebel_20260310.md`
- `docs/Vinculación_y_nomina_20260310.md`

El glosario BP queda fuera del corpus de respuestas (alineado a las instrucciones de tono).

## Setup local

### 1. Variables de entorno

```bash
cp .env.example .env
```

Completa:

- `GROQ_API_KEY` — [console.groq.com](https://console.groq.com/keys)
- `DATABASE_URL` — connection string de Neon
- `DASHBOARD_PASSWORD` — clave del dashboard GH

### 2. Instalar y migrar

```bash
npm install
npm run db:migrate
npm run ingest
npm run dev
```

- Chat: [http://localhost:3000](http://localhost:3000)
- Dashboard: [http://localhost:3000/dashboard](http://localhost:3000/dashboard)

### 3. Checklist Vercel

1. Importar el repo en Vercel.
2. Env vars: `GROQ_API_KEY`, `DATABASE_URL`, `DASHBOARD_PASSWORD`, y opcionales de WhatsApp.
3. Deploy.
4. En local (o CI): `DATABASE_URL=... npm run db:migrate && npm run ingest` contra la misma Neon.
5. Probar chat y dashboard en la URL de Vercel.

### 4. WhatsApp (sandbox Meta)

1. Crear app en [Meta for Developers](https://developers.facebook.com/) → WhatsApp → API Setup.
2. Copiar `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`.
3. `WHATSAPP_VERIFY_TOKEN` = el mismo valor que configures en Meta.
4. Callback URL: `https://<tu-dominio>/api/whatsapp/webhook`
5. Suscribir el webhook al campo `messages`.
6. Enviar un mensaje de prueba desde el número sandbox.

**Notas de voz en WhatsApp:** el webhook descarga el audio y responde pidiendo texto por ahora; el chat web sí soporta micrófono (Web Speech API) y “Escuchar” (TTS del navegador).

**On-prem futuro:** `docker-compose.yml` + `Dockerfile` como base; Evolution API puede sustituir Meta si Prebel lo define en el descubrimiento conjunto.

## Seguridad (prompt injection)

- Sanitización y deny-list de jailbreaks / exfiltración de prompts y secretos.
- Separación estricta system / contexto / usuario en prompts.
- Respuestas grounded al corpus; fuera de alcance → mensaje oficial de no-disponibilidad.
- Eventos `prompt_injection_blocked` en telemetría.
- Sin datos personales de empleados ni herramientas peligrosas.

## Scripts

| Script | Descripción |
|--------|-------------|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Build producción |
| `npm run db:migrate` | Crea tablas en Neon |
| `npm run ingest` | Indexa los 3 MD oficiales |
| `npm run lint` | ESLint |

## Contacto reto Prebel

Alexander Londoño Pineda — Automatización · [prebel.com](https://prebel.com)
