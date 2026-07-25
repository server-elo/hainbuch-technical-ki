import { z } from "zod";

import { LMSTUDIO_URL, MODEL_ID, FAST_MODEL_ID, LLM_TIMEOUT_MS, USE_JSON_OBJECT } from "./config";
import { clientAborted, requestSignal } from "./abort";

export type ChatContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    >;

export interface OpenAiMessage {
  role: "system" | "user" | "assistant";
  content: ChatContent;
}

function extractJsonText(msg: Record<string, unknown>): string {
  let text = String(msg.content || msg.reasoning_content || "");
  text = text.replace(/<think>[\s\S]*?<\/think>/, "").trim();
  const fenced = text.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
  if (fenced) text = fenced[1];
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) text = text.slice(start, end + 1);
  return text;
}

/** One retry with backoff on transient failures (network, 5xx, 429). */
async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, init);
      if ((res.status >= 500 || res.status === 429) && attempt === 0 && !clientAborted()) {
        console.warn(`[LLM] ${res.status} — retrying in 3s`);
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      return res;
    } catch (e) {
      if (attempt === 0 && !clientAborted()) {
        console.warn(`[LLM] network error — retrying in 3s`);
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      throw e;
    }
  }
}

export async function llmJson<T>(
  messages: OpenAiMessage[],
  schema: z.ZodType<T>,
  schemaName: string,
  opts: { fast?: boolean } = {}
): Promise<T> {
  const model = opts.fast ? FAST_MODEL_ID : MODEL_ID;
  const jsonSchema = z.toJSONSchema(schema);
  const requestMessages: OpenAiMessage[] = USE_JSON_OBJECT
    ? [
        {
          role: "system",
          content:
            `Antworte NUR mit einem JSON-Objekt (kein Markdown), das exakt dem Schema "${schemaName}" entspricht:\n` +
            JSON.stringify(jsonSchema),
        },
        ...messages,
      ]
    : messages;
  const res = await fetchWithRetry(`${LMSTUDIO_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: requestSignal(LLM_TIMEOUT_MS),
    body: JSON.stringify({
      model,
      messages: requestMessages,
      temperature: 0.3,
      response_format: USE_JSON_OBJECT
        ? { type: "json_object" }
        : {
            type: "json_schema",
            json_schema: { name: schemaName, strict: true, schema: jsonSchema },
          },
    }),
  });
  if (!res.ok) {
    throw new Error(`LM Studio error (${res.status}): ${await res.text()}`);
  }
  const data = await res.json();
  const msg = data.choices?.[0]?.message ?? {};
  const text = extractJsonText(msg);
  try {
    return schema.parse(JSON.parse(text));
  } catch (err) {
    // One corrective retry: providers in json_object mode occasionally
    // return partial/truncated JSON for large schemas.
    console.warn(`[llmJson] ${schemaName} schema mismatch — corrective retry`);
    const retryRes = await fetchWithRetry(`${LMSTUDIO_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: requestSignal(LLM_TIMEOUT_MS),
      body: JSON.stringify({
        model,
        messages: [
          ...requestMessages,
          {
            role: "user",
            content:
              "Deine letzte Antwort war kein vollständiges JSON nach Schema. Antworte jetzt NUR mit dem kompletten JSON-Objekt, alle Pflichtfelder gefüllt.",
          },
        ],
        temperature: 0.2,
        response_format: USE_JSON_OBJECT
          ? { type: "json_object" }
          : { type: "json_schema", json_schema: { name: schemaName, strict: true, schema: jsonSchema } },
      }),
    });
    if (!retryRes.ok) throw err;
    const retryData = await retryRes.json();
    const retryText = extractJsonText(retryData.choices?.[0]?.message ?? {});
    return schema.parse(JSON.parse(retryText));
  }
}

/** Plain text answer (no schema) for chat-style replies. */
export async function llmText(messages: OpenAiMessage[]): Promise<string> {
  const res = await fetchWithRetry(`${LMSTUDIO_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: requestSignal(LLM_TIMEOUT_MS),
    body: JSON.stringify({ model: MODEL_ID, messages, temperature: 0.5 }),
  });
  if (!res.ok) throw new Error(`LM Studio error (${res.status})`);
  const data = await res.json();
  const msg = data.choices?.[0]?.message ?? {};
  return (msg.content || msg.reasoning_content || "").trim();
}
