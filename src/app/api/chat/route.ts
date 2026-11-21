import { NextRequest, NextResponse } from "next/server";
import { handleChat } from "@/lib/orchestrator/chat";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const message = String(body.message ?? "").trim();
    if (!message) {
      return NextResponse.json({ error: "message required" }, { status: 400 });
    }

    const result = await handleChat({
      message,
      sessionId: body.sessionId,
      channel: "web",
      history: Array.isArray(body.history) ? body.history : [],
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("chat error", err);
    const msg = err instanceof Error ? err.message : "Error interno";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
