"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { DashboardMetrics } from "@/lib/telemetry";

const TOPIC_LABELS: Record<string, string> = {
  vinculacion_nomina: "Vinculación y nómina",
  creditos: "Créditos",
  auxilios_beneficios: "Auxilios y beneficios",
  fuera_alcance: "Fuera de alcance",
  blocked: "Bloqueados",
  sin_tema: "Sin tema",
};

export default function DashboardPage() {
  const [password, setPassword] = useState("");
  const [authed, setAuthed] = useState(false);
  const [authError, setAuthError] = useState(false);
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [dashPassword, setDashPassword] = useState("");

  const load = useCallback(async (pwd: string) => {
    setLoading(true);
    try {
      const res = await fetch("/api/dashboard/metrics?days=30", {
        headers: { "x-dashboard-password": pwd },
      });
      if (!res.ok) {
        setAuthed(false);
        setAuthError(true);
        return;
      }
      const data = await res.json();
      setMetrics(data);
      setAuthed(true);
      setAuthError(false);
      setDashPassword(pwd);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const saved =
      typeof window !== "undefined"
        ? sessionStorage.getItem("gh_dash_pwd")
        : null;
    if (saved) void load(saved);
  }, [load]);

  const onLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const login = await fetch("/api/dashboard/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!login.ok) {
      setAuthError(true);
      return;
    }
    sessionStorage.setItem("gh_dash_pwd", password);
    await load(password);
  };

  if (!authed) {
    return (
      <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
        <h1
          className="text-3xl font-semibold text-[var(--forest)]"
          style={{ fontFamily: "var(--font-display), serif" }}
        >
          Dashboard GH
        </h1>
        <p className="mt-2 text-sm text-[var(--ink)]/65">
          Acceso para personal de Gestión Humana. Telemetría de consultas del
          chatbot.
        </p>
        <form onSubmit={onLogin} className="mt-6 space-y-3">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Clave del dashboard"
            className="w-full rounded-xl border border-[var(--forest)]/15 bg-white px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[var(--mint)]/50"
          />
          {authError && (
            <p className="text-xs text-[var(--coral)]">Clave incorrecta</p>
          )}
          <button
            type="submit"
            className="w-full rounded-full bg-[var(--leaf)] py-2.5 text-sm font-semibold text-white hover:bg-[var(--forest)]"
          >
            Entrar
          </button>
        </form>
        <Link href="/" className="mt-6 text-center text-sm text-[var(--leaf)]">
          ← Volver al chat
        </Link>
      </div>
    );
  }

  const pct = (n: number) => `${Math.round(n * 100)}%`;

  return (
    <div className="mx-auto min-h-screen max-w-5xl px-4 py-8 sm:px-6">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-[var(--leaf)]">
            Telemetría · últimos 30 días
          </p>
          <h1
            className="mt-1 text-3xl font-semibold text-[var(--forest)]"
            style={{ fontFamily: "var(--font-display), serif" }}
          >
            Decisiones Gestión Humana
          </h1>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void load(dashPassword)}
            className="rounded-full border border-[var(--leaf)]/30 bg-white px-3 py-1.5 text-xs font-medium text-[var(--forest)]"
          >
            {loading ? "Actualizando…" : "Actualizar"}
          </button>
          <Link
            href="/"
            className="rounded-full bg-[var(--forest)] px-3 py-1.5 text-xs font-medium text-white"
          >
            Ir al chat
          </Link>
        </div>
      </header>

      {metrics && (
        <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Consultas"
              value={String(metrics.totalQueries)}
              hint="Mensajes de colaboradores"
            />
            <Stat
              label="Respuestas grounded"
              value={pct(metrics.groundedRate)}
              hint="Ancladas al corpus"
            />
            <Stat
              label="Contrapreguntas"
              value={pct(metrics.clarificationRate)}
              hint="Para enfocar la duda"
            />
            <Stat
              label="Inyecciones bloqueadas"
              value={String(metrics.blockedCount)}
              hint="Intentos de prompt injection"
            />
          </section>

          <section className="mt-6 grid gap-4 lg:grid-cols-2">
            <Panel title="Volumen por canal">
              {metrics.byChannel.length === 0 ? (
                <Empty />
              ) : (
                <Bars
                  items={metrics.byChannel.map((c) => ({
                    label: c.channel,
                    value: c.count,
                  }))}
                />
              )}
            </Panel>
            <Panel title="Temas más consultados">
              {metrics.byTopic.length === 0 ? (
                <Empty />
              ) : (
                <Bars
                  items={metrics.byTopic.map((t) => ({
                    label: TOPIC_LABELS[t.topic] ?? t.topic,
                    value: t.count,
                  }))}
                />
              )}
            </Panel>
          </section>

          <section className="mt-6 grid gap-4 lg:grid-cols-2">
            <Panel title="Latencia de respuesta">
              <div className="flex gap-8">
                <div>
                  <p className="text-xs text-[var(--ink)]/50">p50</p>
                  <p className="text-2xl font-semibold text-[var(--forest)]">
                    {metrics.latencyP50 != null
                      ? `${metrics.latencyP50} ms`
                      : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[var(--ink)]/50">p95</p>
                  <p className="text-2xl font-semibold text-[var(--forest)]">
                    {metrics.latencyP95 != null
                      ? `${metrics.latencyP95} ms`
                      : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-[var(--ink)]/50">Fuera de alcance</p>
                  <p className="text-2xl font-semibold text-[var(--coral)]">
                    {metrics.outOfScopeCount}
                  </p>
                </div>
              </div>
            </Panel>
            <Panel title="Volumen diario">
              {metrics.dailyVolume.length === 0 ? (
                <Empty />
              ) : (
                <div className="flex h-28 items-end gap-1">
                  {metrics.dailyVolume.map((d) => {
                    const max = Math.max(
                      ...metrics.dailyVolume.map((x) => x.count),
                      1
                    );
                    const h = Math.max(8, (d.count / max) * 100);
                    return (
                      <div
                        key={d.day}
                        className="group relative flex-1 rounded-t bg-[var(--mint)]/80 transition hover:bg-[var(--leaf)]"
                        style={{ height: `${h}%` }}
                        title={`${d.day}: ${d.count}`}
                      />
                    );
                  })}
                </div>
              )}
            </Panel>
          </section>

          <section className="mt-6">
            <Panel title="Preguntas con cobertura débil (candidatos a ampliar KB)">
              {metrics.uncoveredQuestions.length === 0 ? (
                <Empty />
              ) : (
                <ul className="space-y-2">
                  {metrics.uncoveredQuestions.map((q, i) => (
                    <li
                      key={`${q.createdAt}-${i}`}
                      className="rounded-xl bg-[var(--sand)] px-3 py-2 text-sm"
                    >
                      <p className="text-[var(--ink)]">{q.content}</p>
                      <p className="mt-1 text-[11px] text-[var(--ink)]/45">
                        {new Date(q.createdAt).toLocaleString("es-CO")}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </section>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--forest)]/10 bg-white/80 p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-[var(--ink)]/45">
        {label}
      </p>
      <p className="mt-2 text-3xl font-semibold text-[var(--forest)]">{value}</p>
      <p className="mt-1 text-xs text-[var(--ink)]/55">{hint}</p>
    </div>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-[var(--forest)]/10 bg-white/80 p-5 shadow-sm">
      <h2 className="mb-4 text-sm font-semibold text-[var(--forest)]">{title}</h2>
      {children}
    </div>
  );
}

function Bars({ items }: { items: { label: string; value: number }[] }) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item.label}>
          <div className="mb-1 flex justify-between text-xs">
            <span className="text-[var(--ink)]/80">{item.label}</span>
            <span className="font-medium text-[var(--forest)]">{item.value}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[var(--foam)]">
            <div
              className="h-full rounded-full bg-[var(--leaf)]"
              style={{ width: `${(item.value / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function Empty() {
  return (
    <p className="text-sm text-[var(--ink)]/45">
      Aún no hay datos. Usa el chat para generar telemetría.
    </p>
  );
}
