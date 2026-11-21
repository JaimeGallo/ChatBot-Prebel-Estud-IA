import { NextRequest, NextResponse } from "next/server";
import { handleChat } from "@/lib/orchestrator/chat";
import {
  parseWhatsAppWebhook,
  sendWhatsAppText,
  isWhatsAppConfigured,
  downloadWhatsAppMedia,
} from "@/lib/whatsapp/client";

export const maxDuration = 60;

/** Meta webhook verification */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");
  const verify = process.env.WHATSAPP_VERIFY_TOKEN ?? "prebel_verify_token";

  if (mode === "subscribe" && token === verify) {
    return new NextResponse(challenge ?? "", { status: 200 });
  }
  return NextResponse.json({ error: "Forbidden" }, { status: 403 });
}

export async function POST(req: NextRequest) {
  const body = await req.json();

  // Always 200 quickly for Meta; process inline for demo (or queue in prod)
  const messages = parseWhatsAppWebhook(body);

  if (!isWhatsAppConfigured()) {
    console.warn("WhatsApp not configured; webhook received but not replied");
    return NextResponse.json({ ok: true, configured: false });
  }

  for (const msg of messages) {
    let text = msg.text;

    if (!text && msg.audioId) {
      try {
        // Voice notes: acknowledge limitation unless Whisper is wired
        await downloadWhatsAppMedia(msg.audioId);
        text = undefined;
        await sendWhatsAppText(
          msg.from,
          "Recibí tu nota de voz. Por ahora responde por texto o usa el chat web con micrófono. Pronto habilitaremos transcripción en WhatsApp."
        );
        continue;
      } catch (err) {
        console.error("audio download failed", err);
        continue;
      }
    }

    if (!text) continue;

    try {
      const result = await handleChat({
        message: text,
        channel: "whatsapp",
        externalId: msg.from,
      });
      await sendWhatsAppText(msg.from, result.reply);
    } catch (err) {
      console.error("whatsapp handle failed", err);
      try {
        await sendWhatsAppText(
          msg.from,
          "Tuvimos un problema temporal. Intenta de nuevo en unos minutos."
        );
      } catch {
        /* ignore */
      }
    }
  }

  return NextResponse.json({ ok: true });
}
