const GRAPH = "https://graph.facebook.com/v21.0";

export function isWhatsAppConfigured(): boolean {
  return Boolean(
    process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID
  );
}

export async function sendWhatsAppText(to: string, body: string) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneId) {
    throw new Error("WhatsApp credentials not configured");
  }

  // WhatsApp has a 4096 char limit; split if needed
  const chunks: string[] = [];
  let rest = body;
  while (rest.length > 4000) {
    const cut = rest.lastIndexOf("\n", 4000);
    chunks.push(rest.slice(0, cut > 0 ? cut : 4000));
    rest = rest.slice(cut > 0 ? cut : 4000).trim();
  }
  if (rest) chunks.push(rest);

  for (const text of chunks) {
    const res = await fetch(`${GRAPH}/${phoneId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { preview_url: false, body: text },
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`WhatsApp send failed: ${res.status} ${err}`);
    }
  }
}

export type IncomingWhatsAppMessage = {
  from: string;
  messageId: string;
  text?: string;
  audioId?: string;
};

export function parseWhatsAppWebhook(body: unknown): IncomingWhatsAppMessage[] {
  const out: IncomingWhatsAppMessage[] = [];
  const payload = body as {
    entry?: {
      changes?: {
        value?: {
          messages?: {
            from: string;
            id: string;
            type: string;
            text?: { body: string };
            audio?: { id: string };
          }[];
        };
      }[];
    }[];
  };

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const msg of change.value?.messages ?? []) {
        out.push({
          from: msg.from,
          messageId: msg.id,
          text: msg.type === "text" ? msg.text?.body : undefined,
          audioId: msg.type === "audio" ? msg.audio?.id : undefined,
        });
      }
    }
  }
  return out;
}

/** Download media (e.g. voice note) from Meta Graph API */
export async function downloadWhatsAppMedia(
  mediaId: string
): Promise<ArrayBuffer> {
  const token = process.env.WHATSAPP_TOKEN;
  if (!token) throw new Error("WHATSAPP_TOKEN missing");

  const meta = await fetch(`${GRAPH}/${mediaId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!meta.ok) throw new Error(`Media meta failed: ${meta.status}`);
  const { url } = (await meta.json()) as { url: string };

  const file = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!file.ok) throw new Error(`Media download failed: ${file.status}`);
  return file.arrayBuffer();
}
