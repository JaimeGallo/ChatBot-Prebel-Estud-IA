"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

type Msg = {
  id: string;
  role: "user" | "assistant";
  content: string;
  clarified?: boolean;
  options?: string[];
  grounded?: boolean;
};

type SpeechRec = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((ev: {
    results: { [index: number]: { [index: number]: { transcript: string } } };
  }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};

type SpeechRecCtor = new () => SpeechRec;

const WELCOME: Msg = {
  id: "welcome",
  role: "assistant",
  content:
    "¡Hola! Soy el asistente de Gestión Humana Prebel. Puedo ayudarte con vinculación y nómina, créditos, o auxilios y beneficios. Escribe tu duda o usa el micrófono.\n\nRecuerda: este asistente responde únicamente con base en los documentos cargados.",
};

export function ChatApp() {
  const [messages, setMessages] = useState<Msg[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [listening, setListening] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRec | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const speak = useCallback((id: string, text: string) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "es-CO";
    utter.rate = 1.02;
    const voices = window.speechSynthesis.getVoices();
    const es = voices.find((v) => v.lang.startsWith("es"));
    if (es) utter.voice = es;
    utter.onstart = () => setSpeakingId(id);
    utter.onend = () => setSpeakingId(null);
    utter.onerror = () => setSpeakingId(null);
    window.speechSynthesis.speak(utter);
  }, []);

  const stopSpeak = () => {
    window.speechSynthesis?.cancel();
    setSpeakingId(null);
  };

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;
    setError(null);
    setInput("");
    const userMsg: Msg = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
    };
    setMessages((m) => [...m, userMsg]);
    setLoading(true);

    try {
      const history = [...messages, userMsg]
        .filter((m) => m.id !== "welcome")
        .slice(-6)
        .map((m) => ({ role: m.role, content: m.content }));

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          sessionId,
          history,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Error al consultar");

      setSessionId(data.sessionId);
      const assistant: Msg = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: data.reply,
        clarified: data.clarified,
        options: data.options,
        grounded: data.grounded,
      };
      setMessages((m) => [...m, assistant]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setLoading(false);
    }
  };

  const toggleListen = () => {
    const w = window as unknown as {
      SpeechRecognition?: SpeechRecCtor;
      webkitSpeechRecognition?: SpeechRecCtor;
    };
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) {
      setError("Tu navegador no soporta reconocimiento de voz. Usa Chrome o Edge.");
      return;
    }

    if (listening && recognitionRef.current) {
      recognitionRef.current.stop();
      setListening(false);
      return;
    }

    const recognition = new SR();
    recognition.lang = "es-CO";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onresult = (ev) => {
      const transcript = ev.results[0]?.[0]?.transcript ?? "";
      if (transcript) {
        setInput(transcript);
        void send(transcript);
      }
    };
    recognition.onerror = () => {
      setListening(false);
      setError("No se pudo capturar el audio. Revisa el permiso del micrófono.");
    };
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-4 pb-8 pt-6 sm:px-6">
      <header className="animate-rise mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium tracking-wide text-[var(--leaf)]">
            Prebel · EstudIA
          </p>
          <h1
            className="mt-1 text-3xl font-semibold tracking-tight text-[var(--forest)] sm:text-4xl"
            style={{ fontFamily: "var(--font-display), serif" }}
          >
            Gestión Humana
          </h1>
          <p className="mt-2 max-w-md text-sm text-[var(--ink)]/70">
            Consulta trámites por texto o voz. Respuestas ancladas a los documentos
            oficiales.
          </p>
        </div>
        <Link
          href="/dashboard"
          className="shrink-0 rounded-full border border-[var(--leaf)]/25 bg-white/70 px-3 py-1.5 text-xs font-medium text-[var(--forest)] backdrop-blur transition hover:border-[var(--leaf)] hover:bg-white"
        >
          Dashboard GH
        </Link>
      </header>

      <main className="animate-rise flex flex-1 flex-col overflow-hidden rounded-3xl border border-[var(--forest)]/10 bg-white/75 shadow-[0_20px_60px_-30px_rgba(26,61,50,0.45)] backdrop-blur-md">
        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-6">
          {messages.map((m, idx) => (
            <div
              key={m.id}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              style={{ animationDelay: `${Math.min(idx, 6) * 40}ms` }}
            >
              <div
                className={`max-w-[92%] rounded-2xl px-4 py-3 text-[0.95rem] leading-relaxed sm:max-w-[85%] ${
                  m.role === "user"
                    ? "bg-[var(--forest)] text-white"
                    : "bg-[var(--foam)]/80 text-[var(--ink)]"
                }`}
              >
                <p className="whitespace-pre-wrap">{m.content}</p>
                {m.options && m.options.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {m.options.map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => void send(opt)}
                        className="rounded-full border border-[var(--leaf)]/40 bg-white/80 px-3 py-1 text-xs font-medium text-[var(--forest)] transition hover:bg-white"
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                )}
                {m.role === "assistant" && m.id !== "welcome" && (
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        speakingId === m.id ? stopSpeak() : speak(m.id, m.content)
                      }
                      className="inline-flex items-center gap-1.5 rounded-full bg-white/70 px-2.5 py-1 text-xs font-medium text-[var(--leaf)] transition hover:bg-white"
                    >
                      {speakingId === m.id ? (
                        <>
                          <span className="flex h-3 items-end gap-0.5">
                            <span className="wave-bar inline-block h-3 w-0.5 rounded bg-[var(--leaf)]" />
                            <span
                              className="wave-bar inline-block h-3 w-0.5 rounded bg-[var(--leaf)]"
                              style={{ animationDelay: "0.15s" }}
                            />
                            <span
                              className="wave-bar inline-block h-3 w-0.5 rounded bg-[var(--leaf)]"
                              style={{ animationDelay: "0.3s" }}
                            />
                          </span>
                          Detener
                        </>
                      ) : (
                        <>Escuchar</>
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="rounded-2xl bg-[var(--foam)]/80 px-4 py-3 text-sm text-[var(--ink)]/60">
                Consultando documentos…
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="border-t border-[var(--forest)]/8 bg-white/60 px-4 py-4 sm:px-6">
          {error && (
            <p className="mb-2 text-xs text-[var(--coral)]" role="alert">
              {error}
            </p>
          )}
          <form
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <button
              type="button"
              onClick={toggleListen}
              aria-label={listening ? "Detener micrófono" : "Hablar"}
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition ${
                listening
                  ? "listening-ring border-[var(--coral)] bg-[var(--coral)] text-white"
                  : "border-[var(--leaf)]/30 bg-white text-[var(--leaf)] hover:border-[var(--leaf)]"
              }`}
            >
              <MicIcon />
            </button>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              rows={1}
              placeholder="Ej. requisitos para retirar cesantías por compra de vivienda"
              className="max-h-32 min-h-11 flex-1 resize-none rounded-2xl border border-[var(--forest)]/12 bg-white px-4 py-2.5 text-sm outline-none ring-[var(--mint)]/40 transition focus:ring-2"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="h-11 shrink-0 rounded-full bg-[var(--leaf)] px-5 text-sm font-semibold text-white transition hover:bg-[var(--forest)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Enviar
            </button>
          </form>
          <p className="mt-2 text-center text-[11px] text-[var(--ink)]/45">
            Información interna no sensible · Validar con Gestión Humana ante dudas
          </p>
        </div>
      </main>
    </div>
  );
}

function MicIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 14a3 3 0 0 0 3-3V7a3 3 0 1 0-6 0v4a3 3 0 0 0 3 3Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path
        d="M19 11a7 7 0 0 1-14 0M12 18v3"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
