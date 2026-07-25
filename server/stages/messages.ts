export type ImagePart = { type: "image_url"; image_url: { url: string } };

export function conversationText(messages: any[]): string {
  const parts: string[] = [];
  for (const msg of messages) {
    const who = msg.role === "model" ? "Berater" : "Kunde";
    for (const part of msg.parts || []) {
      if (part.text) parts.push(`${who}: ${part.text}`);
    }
  }
  return parts.join("\n");
}

/** Collect drawings from the WHOLE conversation (newest first, max 3).
 *  Critical: after a clarifying question the user answers in plain text —
 *  the drawing from an earlier message must not be forgotten. */
export function lastUserImages(messages: any[]): ImagePart[] {
  const images: ImagePart[] = [];
  for (const msg of [...messages].reverse()) {
    if (msg.role !== "user") continue;
    for (const part of msg.parts || []) {
      if (part.inlineData && images.length < 3 && !/dxf|pdf/i.test(part.inlineData.mimeType || "")) {
        images.push({
          type: "image_url",
          image_url: {
            url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
          },
        });
      }
    }
    if (images.length >= 3) break;
  }
  return images;
}

function lastUserInlineData(messages: any[], mime: RegExp): string | null {
  for (const msg of [...messages].reverse()) {
    if (msg.role !== "user") continue;
    for (const part of msg.parts || []) {
      if (part.inlineData && mime.test(part.inlineData.mimeType || "")) return part.inlineData.data;
    }
  }
  return null;
}

export const lastUserDxf = (messages: any[]) => lastUserInlineData(messages, /dxf/i);
export const lastUserPdf = (messages: any[]) => lastUserInlineData(messages, /pdf/i);

/** Text of the newest user message (all text parts joined). */
export function lastUserText(messages: any[]): string {
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  return (lastUser?.parts || [])
    .map((p: any) => p.text || "")
    .join(" ")
    .trim();
}
