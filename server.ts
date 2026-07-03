import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { z } from "zod";
import sharp from "sharp";
import { Agent, setGlobalDispatcher } from "undici";
import "dotenv/config";

import {
  MATERIAL_KEYS,
  MATERIALS,
  calculatePlan,
  cuttingDataPromptTable,
  type PlannedOperation,
} from "./machining";

const PORT = Number(process.env.PORT || 3000);
const LMSTUDIO_URL = process.env.LMSTUDIO_URL || "http://localhost:1234/v1";
const MODEL_ID = process.env.MODEL_ID || "agents-a1-mlx-oq8";
const RAG_API_URL = process.env.RAG_API_URL || "http://127.0.0.1:7777";
const MAX_RPM = Number(process.env.MAX_RPM || 8000);
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 900000);
// Gemini via VibeProxy ignores strict json_schema — use json_object + schema hint instead.
const USE_JSON_OBJECT =
  process.env.LLM_JSON_OBJECT === "1" ||
  LMSTUDIO_URL.includes(":8317") ||
  MODEL_ID.toLowerCase().includes("gemini");

// Local LLM generations can take many minutes — lift undici's default
// 300 s headers timeout for all fetch calls.
setGlobalDispatcher(
  new Agent({ headersTimeout: LLM_TIMEOUT_MS, bodyTimeout: LLM_TIMEOUT_MS })
);

// ---------------------------------------------------------------------------
// Stage schemas (zod → JSON schema → LM Studio structured output)
// ---------------------------------------------------------------------------

const MaterialStageSchema = z.object({
  // Generated first: forces geometry analysis before any material decision.
  geometryAssessment: z
    .string()
    .describe(
      "Analysiere ZUERST die Teilegeometrie (aus Zeichnung/Beschreibung): Hat das Teil ebene Flächen, Absätze, Taschen, Konsolen-/Gehäuseform (→ prismatisches FRÄSTEIL)? Oder ist es überwiegend rotationssymmetrisch wie Welle/Flansch/Buchse (→ Drehteil)? Nenne die Hauptmaße, die du abliest."
    ),
  partType: z
    .enum(["rotationsteil", "prismatisch"])
    .describe(
      "rotationsteil NUR wenn überwiegend rotationssymmetrisch (Welle, Flansch, Buchse). Blöcke, Konsolen, Gehäuse, Halter mit ebenen Flächen = prismatisch — auch wenn sie einzelne Radien oder Bohrungen haben."
    ),
  materialKey: z.enum(MATERIAL_KEYS as [string, ...string[]]),
  materialName: z
    .string()
    .describe("Konkreter Werkstoff, z.B. 'C45 (1.0503)' oder 'AlMgSi1'"),
  reasoning: z
    .string()
    .describe(
      "2–3 nüchterne, technisch korrekte Sätze: warum dieser Werkstoff passt. Keine Werbesprache, keine falschen Eigenschaften (z.B. ist Automatenstahl NICHT korrosionsbeständig)."
    ),
  rawStock: z.object({
    form: z.enum(["Rundstange", "Sechskant", "Flachmaterial", "Block", "Rohr", "Platte"]),
    finishedPartDimensionsMm: z
      .array(z.number())
      .min(1)
      .max(3)
      .describe(
        "Hauptmaße des FERTIGTEILS in mm aus Zeichnung/Beschreibung: bei Rundteilen [Fertig-Ø, Länge], bei Block-/Plattenteilen [Länge, Breite, Höhe]. Exakt ablesen!"
      ),
    dimensions: z
      .string()
      .describe("Vorschlag Rohmaß mit Aufmaß (wird vom System geprüft und ggf. korrigiert)"),
    norm: z.string().describe("z.B. 'EN 10060' oder 'DIN 1013'"),
  }),
});

const OperationSchema = z.object({
  stepName: z
    .string()
    .describe("Aussagekräftig mit Maßen, z.B. 'Plandrehen Ø96', 'Bohren 4x Ø6,8', 'Reiben Ø12H7'"),
  operationType: z.enum([
    "drehen",
    "fräsen",
    "bohren",
    "senken",
    "reiben",
    "gewindebohren",
  ]),
  tool: z
    .string()
    .describe(
      "Realistisches Werkzeug, z.B. 'Drehmeißel mit Wendeplatte CNMG', 'VHM-Schaftfräser D12 z4', 'Spiralbohrer D6,8', 'Kegelsenker 90°', 'Maschinenreibahle D12 H7', 'Gewindebohrer M8'"
    ),
  diameterMm: z
    .number()
    .describe("Werkzeug-Ø in mm (Fräsen/Bohren) bzw. Werkstück-Ø (Drehen)"),
  teeth: z.number().optional().describe("Zähnezahl z (nur Fräsen)"),
  cutLengthMm: z.number().describe("Schnittweg in mm für EINEN Schnitt/Durchgang"),
  passes: z.number().describe("Anzahl Schnitte/Durchgänge (auch Anzahl Bohrungen)"),
  threadPitchMm: z.number().optional().describe("Gewindesteigung P (nur Gewindebohren)"),
  vcSuggested: z.number().describe("Schnittgeschwindigkeit vc in m/min aus Richtwerten"),
  feedSuggested: z
    .number()
    .describe("Vorschub: f in mm/U (Drehen/Bohren/Senken/Reiben) oder fz in mm/Zahn (Fräsen)"),
  removalVolumeCm3: z
    .number()
    .optional()
    .describe("NUR bei Schrupp-Operationen (Fräsen/Drehen): abzutragendes Volumen in cm³ (Rohteil minus Fertigkontur, anteilig für diesen Schritt). Der Server prüft die Zeit gegen die physikalische Abtragsrate."),
  apMm: z.number().optional().describe("Zustellung ap in mm (Schruppen)"),
  aeMm: z.number().optional().describe("Eingriffsbreite ae in mm (nur Fräsen, Schruppen)"),
});

const PlanStageSchema = z.object({
  // Generated FIRST (schema order = generation order): forces the model to
  // reason about the geometry before it commits to operations.
  geometryAnalysis: z
    .string()
    .describe(
      "Denke hier Schritt für Schritt, BEVOR du planst: 1) Ist das Werkstück ein Rotationsteil (Drehen) oder ein prismatisches Frästeil (KEIN Drehen)? 2) Welche Features hat es (Bohrungen, Nuten, Radien, Schrägen, Passungen) mit welchen Maßen? 3) Wie viele Aufspannungen, welche Flächen zuerst? 4) Welches Spannmittel passt zur Teileform? Erst danach die übrigen Felder ausfüllen — sie müssen zu dieser Analyse passen."
    ),
  message: z
    .string()
    .describe(
      "Direkte Antwort AN den Kunden als Hainbuch-Vertriebsingenieur. Beantworte ALLE Fragen des Kunden konkret mit Zahlen — Passungsfragen IMMER mit den exakten Werten aus der FERTIGEN LÖSUNG (P_SH, P_ÜH, Grenzmaße). Keine Meta-Kommentare über den Ablauf. Rückfrage nach Stückzahl nur falls unbekannt."
    ),
  fastestMethod: z.string(),
  costEffectiveMethod: z.string(),
  clampingStrategy: z.string().describe("Spannstrategie mit konkreten Hainbuch-Produkten aus dem Katalogauszug"),
  viseMachiningPlan: z.string().describe("OP10/OP20 Aufspannungen: was wird wann wie gespannt und bearbeitet"),
  operations: z.array(OperationSchema),
  recommendations: z
    .array(
      z.object({
        product: z
          .string()
          .describe("NUR HAINBUCH-SPANNMITTEL aus dem Katalogauszug (TOPlus, SPANNTOP, MANDO, MANOK, TOROK …). KEINE Schneidwerkzeuge (Bohrer/Fräser/Reibahlen gehören in den Arbeitsplan, nicht hierher)."),
        description: z.string().describe("Warum dieses Spannmittel; nenne Baugröße und Spannbereich aus dem Katalog"),
        technicalData: z
          .string()
          .describe("Relevante Katalogdaten: Spannbereich, Rundlauf, max. Drehzahl, Mat.-Nr. falls im Auszug"),
      })
    )
    .max(3)
    .describe("1 bis 3 Spannmittel-Empfehlungen, KEINE Preise, KEINE Werkzeuge"),
});

// ---------------------------------------------------------------------------
// LLM + RAG helpers
// ---------------------------------------------------------------------------

type ChatContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    >;

interface OpenAiMessage {
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
      if ((res.status >= 500 || res.status === 429) && attempt === 0) {
        console.warn(`[LLM] ${res.status} — retrying in 3s`);
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      return res;
    } catch (e) {
      if (attempt === 0) {
        console.warn(`[LLM] network error — retrying in 3s`);
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      throw e;
    }
  }
}

async function llmJson<T>(
  messages: OpenAiMessage[],
  schema: z.ZodType<T>,
  schemaName: string
): Promise<T> {
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
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    body: JSON.stringify({
      model: MODEL_ID,
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
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
      body: JSON.stringify({
        model: MODEL_ID,
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

interface RagChunk {
  text: string;
  header: string;
  label: string;
  score: number;
}

async function ragRetrieve(
  query: string,
  collections: string[] | null,
  limit = 5
): Promise<{ context: string; chunks: RagChunk[] }> {
  try {
    const res = await fetch(`${RAG_API_URL}/retrieve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(60000),
      body: JSON.stringify({ query, collections, limit }),
    });
    if (!res.ok) throw new Error(`RAG API ${res.status}`);
    const data = await res.json();
    return { context: data.context || "", chunks: data.chunks || [] };
  } catch (err: any) {
    console.warn(`[RAG] retrieval unavailable (${err.message}) — continuing without context`);
    return { context: "", chunks: [] };
  }
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export interface FitSolution {
  designation: string;
  fitType: string;
  holeGo: number;
  holeGu: number;
  shaftGo: number;
  shaftGu: number;
  psh: number;
  puh: number;
}

const num = (s: string) => parseFloat(s.replace(",", "."));

/** Parse the deterministic FERTIGE LÖSUNG block into structured fit data. */
function parseFitSolutions(context: string): FitSolution[] {
  const block = context.match(/## FERTIGE LÖSUNG[\s\S]*?(?=\n---\n### \[|$)/);
  if (!block) return [];
  const solutions: FitSolution[] = [];
  const re =
    /### Passung (∅\d+ \S+\/\S+) — (\S+) \(berechnet\)\nBohrung [^:]*: G_oB = ([\d,.]+) mm, G_uB = ([\d,.]+) mm\nWelle [^:]*: G_oW = ([\d,.]+) mm, G_uW = ([\d,.]+) mm\nP_SH.* = (-?[\d,.]+) mm\nP_ÜH.* = (-?[\d,.]+) mm/g;
  let m;
  while ((m = re.exec(block[0])) !== null) {
    solutions.push({
      designation: m[1],
      fitType: m[2],
      holeGo: num(m[3]),
      holeGu: num(m[4]),
      shaftGo: num(m[5]),
      shaftGu: num(m[6]),
      psh: num(m[7]),
      puh: num(m[8]),
    });
  }
  return solutions;
}

type EmitFn = (event: object) => void;

// ---------------------------------------------------------------------------
// Drawing analysis: the model reads, the code verifies.
// Tiling makes small dimension text readable; arithmetic chain-checking
// exposes misread values (dimension chains must sum to overall dimensions).
// ---------------------------------------------------------------------------

const DrawingSchema = z.object({
  readingNotes: z
    .string()
    .describe("Gehe ZUERST Ansicht für Ansicht (TOP/FRONT/SIDE/ISO) durch und lies JEDE Maßzahl sorgfältig ab — nutze die vergrößerten Ausschnitte für kleine Zahlen."),
  partType: z.enum(["rotationsteil", "prismatisch"]),
  overallDimensionsMm: z
    .array(z.number())
    .max(3)
    .describe("Hauptabmessungen des Fertigteils in mm: [Länge, Breite, Höhe] bzw. [Ø, Länge]"),
  dimensions: z
    .array(
      z.object({
        label: z.string().describe("Wie auf der Zeichnung, z.B. '96.0', 'R8.0', 'Ø22H7', 'M8'"),
        valueMm: z.number(),
        kind: z.enum(["länge", "durchmesser", "radius", "gewinde", "winkel"]),
        measures: z.string().describe("Was das Maß beschreibt, z.B. 'Gesamtbreite TOP', 'Nut-Radius'"),
      })
    )
    .describe("ALLE lesbaren Maße der Zeichnung"),
  tolerances: z.array(z.string()).describe("Alle Toleranz-/Passungsangaben, z.B. '22H7'"),
});
type DrawingData = z.infer<typeof DrawingSchema>;

/** Full image + 4 zoomed overlapping quadrants, so dimension text is large. */
async function tileImage(b64: string): Promise<Array<{ data: string; mimeType: string }>> {
  const buf = Buffer.from(b64, "base64");
  const img = sharp(buf);
  const meta = await img.metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  const out = [{ data: b64, mimeType: "image/jpeg" }];
  if (!w || !h || Math.max(w, h) < 700) return out; // too small to bother tiling
  const ov = 0.12; // overlap so dimensions on tile borders stay readable
  const tw = Math.round(w * (0.5 + ov));
  const th = Math.round(h * (0.5 + ov));
  const anchors: Array<[number, number]> = [
    [0, 0],
    [w - tw, 0],
    [0, h - th],
    [w - tw, h - th],
  ];
  for (const [left, top] of anchors) {
    const tile = await sharp(buf)
      .extract({ left: Math.max(0, left), top: Math.max(0, top), width: tw, height: th })
      .resize({ width: Math.min(1600, tw * 2) })
      .sharpen({ sigma: 1.1 })
      .jpeg({ quality: 90 })
      .toBuffer();
    out.push({ data: tile.toString("base64"), mimeType: "image/jpeg" });
  }
  return out;
}

/** Chain check: a dimension is 'verified' if it equals a sum of 2-3 other
 *  dimensions (or is part of such a chain) — the built-in redundancy of
 *  technical drawings. */
function verifyDimensions(dims: DrawingData["dimensions"]): {
  verified: Set<number>;
  report: string[];
} {
  const lengths = dims.filter((d) => d.kind === "länge").map((d) => d.valueMm);
  const verified = new Set<number>();
  const report: string[] = [];
  const TOL = 0.15;
  for (let i = 0; i < lengths.length; i++) {
    for (let j = 0; j < lengths.length; j++) {
      if (j === i) continue;
      for (let k = j + 1; k < lengths.length; k++) {
        if (k === i) continue;
        if (Math.abs(lengths[j] + lengths[k] - lengths[i]) <= TOL) {
          [i, j, k].forEach((x) => verified.add(lengths[x]));
          report.push(`${lengths[j]} + ${lengths[k]} = ${lengths[i]} ✓`);
        }
        for (let l = k + 1; l < lengths.length; l++) {
          if (l === i) continue;
          if (Math.abs(lengths[j] + lengths[k] + lengths[l] - lengths[i]) <= TOL) {
            [i, j, k, l].forEach((x) => verified.add(lengths[x]));
            report.push(`${lengths[j]} + ${lengths[k]} + ${lengths[l]} = ${lengths[i]} ✓`);
          }
        }
      }
    }
  }
  return { verified, report: [...new Set(report)].slice(0, 10) };
}

async function analyzeDrawing(
  images: Array<{ type: "image_url"; image_url: { url: string } }>,
  emit: EmitFn
): Promise<{ block: string; drawing: DrawingData } | null> {
  try {
    const first = images[0].image_url.url;
    const b64 = first.split(",")[1] ?? "";
    const tiles = await tileImage(b64);
    const content: any[] = [
      {
        type: "text",
        text:
          "Bild 1 ist die vollständige technische Zeichnung, die weiteren Bilder sind vergrößerte Ausschnitte davon (für kleine Maßzahlen). Lies ALLE Maße ab.",
      },
      ...tiles.map((t) => ({
        type: "image_url",
        image_url: { url: `data:${t.mimeType};base64,${t.data}` },
      })),
    ];
    const sys =
      "Du bist Experte für technische Zeichnungen (2D, Erst-/Drittwinkelprojektion). " +
      "Arbeite die Ansichten NACHEINANDER ab (TOP, dann FRONT, dann SIDE): notiere in readingNotes " +
      "pro Ansicht JEDE sichtbare Maßzahl (auch kleine Ketten-Maße wie 16.0, 12.0, 20.5!), " +
      "dann übertrage ALLE in dimensions. Eine typische Zeichnung hat 10-20 Maße — " +
      "wenn du weniger als 8 findest, hast du welche übersehen. " +
      "Verwechsle keine Ziffern (3↔8, 1↔7, 35↔64, 6↔5).";
    let drawing = await llmJson(
      [
        { role: "system", content: sys },
        { role: "user", content },
      ],
      DrawingSchema,
      "drawing_analysis"
    );
    if (drawing.dimensions.length < 6) {
      console.warn(`[Drawing] only ${drawing.dimensions.length} dims — retrying`);
      drawing = await llmJson(
        [
          { role: "system", content: sys },
          { role: "user", content },
          {
            role: "user",
            content: `Du hast nur ${drawing.dimensions.length} Maße gefunden — das ist zu wenig. Gehe die vergrößerten Ausschnitte einzeln durch und liste wirklich JEDE Maßzahl.`,
          },
        ],
        DrawingSchema,
        "drawing_analysis"
      );
    }
    const { verified, report } = verifyDimensions(drawing.dimensions);
    const dimLines = drawing.dimensions.map(
      (d) =>
        `- ${d.label} (${d.kind}, ${d.measures})${
          d.kind === "länge" ? (verified.has(d.valueMm) ? " [rechnerisch bestätigt]" : " [nicht bestätigt — prüfen]") : ""
        }`
    );
    const unverifiedWarning =
      report.length === 0 && drawing.dimensions.filter((d) => d.kind === "länge").length >= 3
        ? "\nWARNUNG: Keine Maßkette konnte rechnerisch bestätigt werden — die abgelesenen Maße sind UNSICHER. Weise den Kunden in der Antwort darauf hin und bitte um Bestätigung der Hauptmaße."
        : "";
    const block =
      `ZEICHNUNGSDATEN (extrahiert, Maßketten rechnerisch geprüft):\n` +
      `Teiletyp: ${drawing.partType}; Hauptmaße: ${drawing.overallDimensionsMm.join(" x ")} mm\n` +
      `Toleranzen: ${drawing.tolerances.join(", ") || "keine"}\n` +
      dimLines.join("\n") +
      (report.length ? `\nMaßketten-Prüfung: ${report.join("; ")}` : "") +
      unverifiedWarning;
    emit({
      type: "info",
      label: `Zeichnung vermessen: ${drawing.overallDimensionsMm.join("×")} mm, ${drawing.dimensions.length} Maße (${report.length} Ketten bestätigt)`,
    });
    return { block, drawing };
  } catch (e: any) {
    console.warn("[Drawing] analysis failed:", e.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Raw-stock guard: the LLM proposes, the code decides. Raw material must
// always be LARGER than the finished part (machining allowance).
// ---------------------------------------------------------------------------

const STANDARD_BAR_D = [
  8, 10, 12, 14, 16, 18, 20, 22, 25, 28, 30, 32, 35, 38, 40, 42, 45, 50, 55,
  60, 63, 65, 70, 75, 80, 85, 90, 95, 100, 110, 115, 120, 130, 140, 150, 160, 180, 200,
];

function normalizeRawStock(
  form: string,
  finished: number[] | undefined,
  proposed: string
): string {
  if (!finished || finished.length === 0 || finished.some((v) => !Number.isFinite(v) || v <= 0)) {
    return proposed;
  }
  const up5 = (v: number) => Math.ceil((v + 4) / 5) * 5;
  if (form === "Rundstange" || form === "Rohr" || form === "Sechskant") {
    const [d, l] = finished;
    const rawD = STANDARD_BAR_D.find((s) => s >= d + 3) ?? Math.ceil(d + 5);
    const rawL = l ? Math.ceil(l + 6) : undefined;
    return rawL ? `Ø${rawD} x ${rawL} mm` : `Ø${rawD} mm`;
  }
  // Block / Platte / Flachmaterial: +4 mm allowance per axis, rounded to 5 mm
  return finished.map(up5).join(" x ") + " mm";
}

// ---------------------------------------------------------------------------
// Intent routing: not every message is a manufacturing job.
// ---------------------------------------------------------------------------

type Intent = "fertigung" | "fachfrage" | "smalltalk";

const LANGUAGES = ["de", "en", "zh", "es", "fr", "it", "tr", "pl", "ru"] as const;
type Language = (typeof LANGUAGES)[number];
const LANGUAGE_NAMES: Record<Language, string> = {
  de: "Deutsch",
  en: "English",
  zh: "Chinese (中文)",
  es: "Español",
  fr: "Français",
  it: "Italiano",
  tr: "Türkçe",
  pl: "Polski",
  ru: "Русский",
};

interface Route {
  intent: Intent;
  language: Language;
  germanQuery: string;
  missingInfo: string[];
}

const IntentSchema = z.object({
  language: z
    .enum(LANGUAGES as unknown as [string, ...string[]])
    .describe("Sprache der Nutzernachricht (ISO-Code)"),
  intent: z
    .enum(["fertigung", "fachfrage", "smalltalk"])
    .describe(
      "fertigung = Werkstück soll geplant/gefertigt werden (Maße/Stückzahl/Arbeitsplan/Spannmittel gewünscht). " +
        "fachfrage = technische Frage zu Toleranzen/Werkstoffen/Produkten ohne Fertigungsauftrag. " +
        "smalltalk = Begrüßung, Dank, Alltagsgespräch."
    ),
  germanQuery: z
    .string()
    .describe(
      "Die Kernanfrage übersetzt ins DEUTSCHE mit Metall-Fachbegriffen (für die Suche in deutschen Fachbüchern und im HAINBUCH-Katalog). Toleranzangaben wie 40H7/m6 unverändert übernehmen."
    ),
  missingInfo: z
    .array(z.enum(["werkstoff", "stueckzahl", "abmessungen"]))
    .describe(
      "NUR bei intent=fertigung: welche essenziellen Angaben fehlen im GESAMTEN Gesprächsverlauf? " +
        "werkstoff = kein Material genannt UND keine freie Wahl gelassen ('frei wählbar', 'egal', 'entscheide du' → NICHT fehlend). " +
        "stueckzahl = keine Losgröße/Stückzahl genannt. " +
        "abmessungen = weder Maße im Text noch eine Zeichnung vorhanden. " +
        "Leeres Array wenn alles vorhanden ist oder der Kunde nach einer Rückfrage bereits geantwortet hat."
    ),
});

const SMALLTALK_RE =
  /^(hi|hallo|hello|hey|servus|moin|guten (morgen|tag|abend)|good (morning|evening)|danke|vielen dank|thanks|thank you|merci|gracias|grazie|ok(ay)?|gut|super|cool|toll|perfekt|wow|test|bye|tsch(ü|ue)ss|你好|谢谢)\b[\s!.,?]*$/i;

// Pure knowledge questions: "Was ist…", "Unterschied zwischen…" etc.
const QUESTION_RE =
  /^(was|wie|warum|wieso|weshalb|welche[rs]?|wann|wo|erkl[äa]r|unterschied|definier|bedeut|gibt es|kann man|ist ein)/i;
const JOB_RE = /st(ü|ue)ck|losgr(ö|oe)(ß|ss)e|fertig|arbeitsplan|zeichnung|planen|bearbeiten|herstellen/i;

async function classifyIntent(
  lastText: string,
  hasImage: boolean,
  conversationTail: string
): Promise<Route> {
  const t = lastText.trim();
  if (t.length < 30 && SMALLTALK_RE.test(t)) {
    return { intent: "smalltalk", language: "de", germanQuery: "", missingInfo: [] };
  }
  // German pure knowledge questions skip the LLM entirely.
  if (!hasImage && QUESTION_RE.test(t) && !JOB_RE.test(t)) {
    return { intent: "fachfrage", language: "de", germanQuery: t, missingInfo: [] };
  }
  try {
    const r = await llmJson(
      [
        {
          role: "system",
          content:
            "Klassifiziere die letzte Kundennachricht und erkenne die Sprache.\n" +
            "WICHTIG: Die Wissensbasis ist auf Deutsch, aber die Retrieval-Anfrage (germanQuery) soll EXAKT der Original-Anfrage des Users entsprechen — NICHT übersetzen.\n" +
            "1. Erkenne die Sprache des Users (language).\n" +
            "2. Gib die Original-Anfrage des Users 1:1 als germanQuery zurück (keine Übersetzung!).\n" +
            "3. Klassifiziere den Intent:\n" +
            "   - fertigung: Konkretes Werkstück soll geplant/gefertigt werden.\n" +
            "   - fachfrage: Reine Wissensfrage zu Toleranzen, Passungen, Werkstoffen etc.\n" +
            "   - smalltalk: Begrüßung, Dank, Alltagsgespräch.\n" +
            (hasImage ? "Eine technische Zeichnung liegt bei → abmessungen fehlen NICHT." : ""),
        },
        {
          role: "user",
          content: `GESPRÄCHSVERLAUF:\n${conversationTail.slice(-2200)}\n\nLETZTE NACHRICHT:\n${t.slice(0, 1200)}`,
        },
      ],
      IntentSchema,
      "route"
    ) as { intent: Intent; language: string; germanQuery: string; missingInfo?: string[] };
    const language = (LANGUAGES as readonly string[]).includes(r.language)
      ? (r.language as Language)
      : "de";
    let missingInfo = r.missingInfo ?? [];
    if (hasImage) missingInfo = missingInfo.filter((m) => m !== "abmessungen");
    return {
      intent: hasImage ? "fertigung" : r.intent,
      language,
      germanQuery: r.germanQuery || t,
      missingInfo,
    };
  } catch {
    return { intent: "fertigung", language: "de", germanQuery: t, missingInfo: [] };
  }
}

/** Plain text answer (no schema) for chat-style replies. */
async function llmText(messages: OpenAiMessage[]): Promise<string> {
  const res = await fetchWithRetry(`${LMSTUDIO_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    body: JSON.stringify({ model: MODEL_ID, messages, temperature: 0.5 }),
  });
  if (!res.ok) throw new Error(`LM Studio error (${res.status})`);
  const data = await res.json();
  const msg = data.choices?.[0]?.message ?? {};
  return (msg.content || msg.reasoning_content || "").trim();
}

function conversationText(messages: any[]): string {
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
function lastUserImages(messages: any[]): Array<{ type: "image_url"; image_url: { url: string } }> {
  const images: Array<{ type: "image_url"; image_url: { url: string } }> = [];
  for (const msg of [...messages].reverse()) {
    if (msg.role !== "user") continue;
    for (const part of msg.parts || []) {
      if (part.inlineData && images.length < 3) {
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

async function runPipeline(messages: any[], emit: EmitFn = () => {}) {
  const conversation = conversationText(messages);
  const images = lastUserImages(messages);
  const sources = new Set<string>();

  // ---- Stage 0: what does the user actually need? ----
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const lastText = (lastUser?.parts || [])
    .map((p: any) => p.text || "")
    .join(" ")
    .trim();
  emit({ type: "status", stage: "intent", label: "Anfrage wird eingeordnet…" });
  const route = await classifyIntent(lastText, images.length > 0, conversation);
  const { intent, language, germanQuery } = route;
  const langName = LANGUAGE_NAMES[language];
  const answerLang =
    language === "de"
      ? "Antworte auf Deutsch."
      : `WICHTIG: Antworte in ${langName} (die Sprache des Kunden). Deutsche Fachbegriffe und Produktnamen (Passung, Spannmittel, TOPlus …) darfst du in Klammern beibehalten.`;
  console.log(`[Pipeline] intent: ${intent}, language: ${language}`);

  if (intent === "smalltalk") {
    emit({ type: "status", stage: "chat", label: "Antwort wird formuliert…" });
    const message = await llmText([
      {
        role: "system",
        content:
          "Du bist der HAINBUCH Technical Advisor — freundlich, professionell. " +
          "Antworte kurz und natürlich IN DER SPRACHE DES KUNDEN. Biete bei Gelegenheit an, " +
          "bei Werkstück, Arbeitsplan, Passungen oder Spannmitteln zu helfen. Keine erfundenen Fakten.",
      },
      { role: "user", content: conversation.slice(-2000) },
    ]);
    return { message, mode: "chat" };
  }

  if (intent === "fachfrage") {
    emit({ type: "status", stage: "chat", label: "Fachwissen wird nachgeschlagen…" });
    // Retrieval always in German — that is the language of the knowledge base.
    const rag = await ragRetrieve(lastText, null, 6);  // use original user query, not translated
    const fitSolutions = parseFitSolutions(rag.context);
    let message = await llmText([
      {
        role: "system",
        content:
          `Du bist der HAINBUCH Technical Advisor. Beantworte die Fachfrage präzise. ${answerLang} ` +
          "ABSOLUTE REGEL: Die Antwort darf NUR aus den mitgelieferten RAG-AUSZÜGEN (HAINBUCH-Katalog + Fachkunde + Technisches Zeichnen) kommen. " +
          "1. Wenn die Information in den Auszügen steht → antworte exakt daraus (mit Header/Seite wenn möglich).\n" +
          "2. Wenn die Information NICHT in den Auszügen steht → sage KLAR: "Diese Information ist in den vorliegenden Unterlagen nicht enthalten."\n" +
          "3. Keine Ergänzungen aus dem allgemeinen Modellwissen erlaubt.\n" +
          "4. Passungswerte: nur aus ## FERTIGE LÖSUNG exakt übernehmen." +
          (rag.context ? `\n\nFACHBUCH-AUSZÜGE:\n${rag.context.slice(0, 10000)}` : ""),
      },
      { role: "user", content: conversation.slice(-3000) },
    ]);
    const fitBlock = rag.context.match(/## FERTIGE LÖSUNG[\s\S]*?(?=\n---\n### \[|$)/);
    if (fitBlock) {
      const solutions = fitBlock[0]
        .split("\n")
        .filter((l) => !l.startsWith("## FERTIGE"))
        .join("\n")
        .trim();
      if (solutions)
        message += `\n\n📐 ${language === "de" ? "Passung nach ISO 286 (berechnet)" : "Fit per ISO 286 (calculated)"}:\n${solutions}`;
    }
    return { message, mode: "chat", fitSolutions };
  }

  // ---- Requirements gathering: a real sales engineer asks before planning.
  // Ask exactly once (marker guard) for missing essentials, in priority order.
  const ASK_MARKER = "▸";
  const alreadyAsked = messages.some(
    (m: any) =>
      m.role === "model" &&
      (m.parts || []).some((p: any) => (p.text || "").includes(ASK_MARKER))
  );
  if (route.missingInfo.length > 0 && !alreadyAsked) {
    emit({ type: "status", stage: "chat", label: "Rückfragen werden formuliert…" });
    const ORDER = ["werkstoff", "stueckzahl", "abmessungen"];
    const items = ORDER.filter((m) => route.missingInfo.includes(m));
    const LABELS: Record<string, string> = {
      werkstoff: "Werkstoff (z. B. C45, 1.4301, AlMgSi1 — oder „frei wählbar“)",
      stueckzahl: "Stückzahl / Losgröße (beeinflusst Spannmittel & Strategie)",
      abmessungen: "Hauptabmessungen des Werkstücks (oder Zeichnung anhängen)",
    };
    const askDe =
      "Gern übernehme ich die Auslegung. Damit die Analyse präzise wird, benötige ich noch:\n" +
      items.map((m) => `${ASK_MARKER} ${LABELS[m]}`).join("\n") +
      "\n\nSie können auch „frei wählbar“ sagen — dann treffe ich eine begründete Annahme.";
    const message =
      language === "de"
        ? askDe
        : await llmText([
            {
              role: "system",
              content: `Übersetze die folgende Rückfrage exakt nach ${langName}. Behalte die ${ASK_MARKER}-Aufzählung und Fachbegriffe in Klammern bei.`,
            },
            { role: "user", content: askDe },
          ]);
    return { message, mode: "chat" };
  }

  // ---- Stage 0.5: measure the drawing (tiled vision + chain verification) ----
  let drawingBlock = "";
  let drawingData: DrawingData | null = null;
  if (images.length > 0) {
    emit({ type: "status", stage: "drawing", label: "Zeichnung wird vermessen (Ausschnitte + Maßketten-Prüfung)…" });
    const res = await analyzeDrawing(images, emit);
    if (res) {
      drawingBlock = `\n\n${res.block}`;
      drawingData = res.drawing;
    }
  }

  // ---- Stage 1: material selection (grounded in Fachkunde/Tabellenbuch) ----
  console.log("[Pipeline] Stage 1: material selection");
  emit({
    type: "status",
    stage: "retrieval-material",
    label: "Fachkunde & Tabellenbuch werden durchsucht…",
  });
  const materialRag = await ragRetrieve(
    `Werkstoffauswahl Eigenschaften Zerspanbarkeit: ${lastText} ${conversation.slice(-1200)}`,  // original user language
    ["fachkunde_metall", "fachkunde_lift", "tabellenbuch_metall"],
    4
  );
  materialRag.chunks.forEach((c) => sources.add(`${c.label}: ${c.header.slice(0, 90)}`));

  const materialSystem = `Du bist ein erfahrener Fertigungsingenieur. Wähle den passenden Werkstoff und das Norm-Rohmaterial für das beschriebene Bauteil.
${answerLang} (Gilt für alle Textfelder: geometryAssessment, reasoning.)
Wähle materialKey NUR aus: ${MATERIAL_KEYS.join(", ")}.
Falls der Kunde einen Werkstoff nennt, ordne ihn der passenden Gruppe zu.
ROHMATERIAL-REGEL: prismatische Teile (ebene Flächen, Konsolen, Gehäuse) → Block/Platte; Rotationsteile (Welle, Flansch, Buchse) → Rundstange/Rohr. Rohmaß = Fertigmaß + Aufmaß (wird vom System geprüft).${
    materialRag.context
      ? `\n\nFACHBUCH-AUSZÜGE (nutze sie, wenn relevant):\n${materialRag.context.slice(0, 6000)}`
      : ""
  }`;

  emit({
    type: "status",
    stage: "material",
    label: images.length
      ? "Zeichnung wird analysiert, Werkstoff wird gewählt…"
      : "Werkstoff & Rohmaterial werden gewählt…",
  });
  const material = await llmJson(
    [
      { role: "system", content: materialSystem },
      {
        role: "user",
        content: images.length
          ? [{ type: "text", text: conversation + drawingBlock }, ...images]
          : conversation,
      },
    ],
    MaterialStageSchema,
    "material_selection"
  );
  // The verified drawing data outranks the material stage's own reading.
  if (drawingData) {
    material.partType = drawingData.partType;
    if (drawingData.overallDimensionsMm.length > 0) {
      material.rawStock.finishedPartDimensionsMm = drawingData.overallDimensionsMm;
    }
  }
  console.log(`[Pipeline] Material: ${material.materialName} (${material.materialKey}), partType: ${material.partType}`);
  // Geometry consistency guard: a prismatic part never comes from bar stock.
  if (
    material.partType === "prismatisch" &&
    ["Rundstange", "Rohr", "Sechskant"].includes(material.rawStock.form)
  ) {
    material.rawStock.form = "Block";
  }
  if (
    material.partType === "rotationsteil" &&
    ["Block", "Platte", "Flachmaterial"].includes(material.rawStock.form)
  ) {
    material.rawStock.form = "Rundstange";
  }
  // Deterministic raw-stock correction: allowance is enforced in code.
  material.rawStock.dimensions = normalizeRawStock(
    material.rawStock.form,
    material.rawStock.finishedPartDimensionsMm,
    material.rawStock.dimensions
  );
  emit({
    type: "info",
    label: `Werkstoff gewählt: ${material.materialName} — Rohmaterial ${material.rawStock.form} ${material.rawStock.dimensions}`,
  });

  // ---- Stage 2: operation plan + Hainbuch workholding (grounded in catalogue) ----
  console.log("[Pipeline] Stage 2: operation plan + workholding");
  emit({
    type: "status",
    stage: "retrieval-catalog",
    label: "Hainbuch-Katalog wird durchsucht (Spannmittel)…",
  });
  // Prismatic parts (block/plate) are milled and clamped in stationary
  // workholding — never in a lathe chuck.
  const prismatic =
    material.partType === "prismatisch" ||
    ["Block", "Platte", "Flachmaterial"].includes(material.rawStock.form);
  const clampRag = await ragRetrieve(
    prismatic
      ? `Hainbuch stationäre Spannmittel MANOK TOROK Spannstock 5-Achs Frästeil Werkstück ${material.rawStock.dimensions}`
      : `Hainbuch Spannmittel Spannfutter für: ${conversation.slice(-800)} Werkstoff ${material.materialName} Rohmaterial ${material.rawStock.form} ${material.rawStock.dimensions}`,
    ["hainbuch_katalog_de", "hainbuch_catalogue"],
    5
  );
  clampRag.chunks.forEach((c) => sources.add(`${c.label}: ${c.header.slice(0, 90)}`));

  const planSystem = `Du bist Hainbuch Technical Sales Engineer und Fertigungsplaner.
${answerLang} (Gilt für ALLE Kundentexte: message, clampingStrategy, viseMachiningPlan, fastestMethod, costEffectiveMethod, stepName, descriptions. Produktnamen bleiben original.)
Der Werkstoff ist bereits festgelegt: ${material.materialName} (Gruppe: ${MATERIALS[material.materialKey].label}). Rohmaterial: ${material.rawStock.form} ${material.rawStock.dimensions}.

=== HARTE VORAUSSETZUNG — BEVOR IRGENDETWAS GEPLANT WIRD ===
Prüfe SOFORT am Anfang: Fehlt bei einem prismatischen Teil die DICKe / Materialstärke in der Zeichnung?
Wenn ja → gib NUR diese Nachricht zurück und plane NICHTS:
"Die Dicke / Materialstärke des Teils ist in der Zeichnung nicht angegeben. Bitte geben Sie die Dicke an, damit ich einen korrekten Arbeitsplan erstellen kann."
Nur wenn die Dicke vorhanden ist, darfst du mit dem Arbeitsplan fortfahren.

${
    prismatic
      ? "WICHTIG — TEILEFORM: Das Rohmaterial ist ein BLOCK → prismatisches FRÄSTEIL auf Fräsmaschine/BAZ. Es gibt KEIN Drehen in diesem Arbeitsplan. Spannmittel: stationär (MANOK, TOROK, Spannstock), NICHT TOPlus/SPANNTOP-Futter."
      : "TEILEFORM: Rotationsteil (Rundmaterial) → Drehen zuerst; Spannmittel: Futter/Spannzange (TOPlus, SPANNTOP) für Außenspannung, Spanndorn (MANDO) für Innenspannung."
  }

Erstelle den Arbeitsplan (Reihenfolge nach Analyse: Fräsen/Drehen/Bohren/Senken/Reiben/Gewindebohren).
WICHTIG — HARTE REGEL: Bevor du mit dem Arbeitsplan beginnst, prüfe ob alle kritischen Maße vorhanden sind. Bei prismatischen Teilen ist die DICKe / Materialstärke zwingend erforderlich. Fehlt sie in der Zeichnung → du MUSST SOFORT den User fragen und darfst KEINEN Plan erstellen.

Du gibst NUR die Planungsdaten an (Werkzeug, Durchmesser, Zähnezahl, Schnittweg, Anzahl Schnitte, vc, f/fz aus den Richtwerten). Drehzahl, Vorschubgeschwindigkeit und Zeiten werden NICHT von dir berechnet — das macht der Server deterministisch nach ISO-Formeln.
Bei SCHRUPP-Operationen (großer Materialabtrag): gib zusätzlich removalVolumeCm3 an (abzutragendes Volumen = Rohteil minus Fertigkontur für diesen Schritt) sowie ap/ae — der Server erzwingt daraus die physikalisch mögliche Mindestzeit.
Bei mehreren gleichen Bohrungen: passes = Anzahl der Bohrungen.

${cuttingDataPromptTable(material.materialKey)}

Empfehle Spannmittel NUR aus diesem Katalogauszug (mit echten Baugrößen/Spannbereichen). Wenn der Auszug nichts Passendes enthält, sage das ehrlich:
${clampRag.context ? clampRag.context.slice(0, 8000) : "(Katalog nicht verfügbar — nenne Produktfamilien nur allgemein: TOPlus, SPANNTOP, MANDO, MANOK, TOROK)"}
${
    materialRag.context
      ? `\nTOLERANZ-/WERKSTOFF-AUSZÜGE (Passungswerte hieraus EXAKT übernehmen, nie selbst rechnen):\n${materialRag.context.slice(0, 5000)}`
      : ""
  }

Nenne KEINE Preise oder Kosten — der Kunde erhält Preise nur über ein offizielles Angebot. Frage nach der Stückzahl, falls der Kunde sie nicht genannt hat.

ABSOLUTE REGEL — UNVERHANDLICH (wird streng geprüft):
- Du darfst NUR aus den mitgelieferten RAG-AUSZÜGEN (Katalog + Fachbuch) antworten.
- Wenn eine Information (Maß, Toleranz, Spannbereich, vc, f, Klemmtiefe, Materialnummer, Dicke, etc.) NICHT in den Auszügen steht → schreibe EXPLIZIT: "Diese Information ist in den vorliegenden Unterlagen nicht enthalten."
- KRITISCH bei prismatischen Teilen: Wenn die DICKe / Materialstärke in der Zeichnung fehlt → DU MUSST SOFORT STOPPEN und den User fragen: "Die Dicke / Materialstärke des Teils ist in der Zeichnung nicht angegeben. Bitte geben Sie die Dicke an, damit ich einen korrekten Arbeitsplan erstellen kann."
- Du darfst KEINEN Arbeitsplan, keine Spannmittel-Empfehlung und keine Operationen generieren, solange die Dicke fehlt.
- Niemals Werte erfinden, schätzen oder aus dem allgemeinen Modellwissen ergänzen.
- Auch bei englischen Anfragen: Fakten kommen aus der deutschen Datenbank.`;

  const planMessages: OpenAiMessage[] = [
    { role: "system", content: planSystem },
    {
      role: "user",
      content: images.length
        ? [{ type: "text", text: conversation + drawingBlock }, ...images]
        : conversation,
    },
  ];
  emit({
    type: "status",
    stage: "plan",
    label: "Arbeitsplan & Spannstrategie werden erstellt…",
  });
  let plan = await llmJson(planMessages, PlanStageSchema, "manufacturing_plan");
  if (plan.operations.length === 0) {
    console.warn("[Pipeline] empty operation plan — retrying once");
    emit({ type: "info", label: "Plan unvollständig — zweiter Versuch…" });
    plan = await llmJson(planMessages, PlanStageSchema, "manufacturing_plan");
  }

  // ---- Stage 3: deterministic calculation (no LLM math) ----
  console.log(`[Pipeline] Stage 3: calculating ${plan.operations.length} operations`);
  emit({
    type: "status",
    stage: "calc",
    label: `${plan.operations.length} Operationen werden nach ISO-Formeln berechnet…`,
  });
  const calc = calculatePlan(
    plan.operations as PlannedOperation[],
    material.materialKey,
    MAX_RPM
  );

  // Fit questions: append the code-computed ISO 286 solution verbatim so the
  // customer always gets exact values, regardless of LLM message quality.
  let message = plan.message;
  const fitSolutions = parseFitSolutions(materialRag.context);
  const fitBlock = materialRag.context.match(
    /## FERTIGE LÖSUNG[\s\S]*?(?=\n---\n### \[|$)/
  );
  if (fitBlock) {
    const solutions = fitBlock[0]
      .split("\n")
      .filter((l) => !l.startsWith("## FERTIGE"))
      .join("\n")
      .trim();
    if (solutions) {
      message += `\n\n📐 Passung nach ISO 286 (deterministisch berechnet):\n${solutions}`;
    }
  }

  // Recommendations are workholding only — drop anything that isn't a
  // HAINBUCH product family, cap at 3.
  const HAINBUCH_RE =
    /toplus|spanntop|mando|maxxos|torok|manok|hydrok|b-top|inozet|inoflex|centrex|captex|vario|backenmodul|magnetmodul|stirnmitnehmer|morsekegel|spannkopf|spanndorn|kipptop|monteq/i;
  const recommendations = plan.recommendations
    .filter((r) => HAINBUCH_RE.test(r.product))
    .slice(0, 3);

  return {
    message,
    fitSolutions,
    manufacturingAnalysis: {
      material: {
        name: material.materialName,
        group: MATERIALS[material.materialKey].label,
        reasoning: material.reasoning,
      },
      rawMaterialRecommendation: `${material.rawStock.form} ${material.rawStock.dimensions} (${material.rawStock.norm})`,
      fastestMethod: plan.fastestMethod,
      costEffectiveMethod: plan.costEffectiveMethod,
      clampingStrategy: plan.clampingStrategy,
      viseMachiningPlan: plan.viseMachiningPlan,
      operations: calc.operations.map((op) => ({
        stepName: op.stepName,
        operationType: op.operationType,
        tool: op.tool,
        cuttingData: op.calculation,
        vc: op.vcUsed,
        feed: op.feedUsed,
        feedUnit: op.feedUnit,
        spindleSpeedRpm: op.spindleSpeedRpm,
        feedRateMmPerMin: op.feedRateMmPerMin,
        time: `${op.timeMin.toFixed(2)} min`,
      })),
      totalEstimatedMachiningTime: `${calc.totalTimeMin.toFixed(2)} min (Schnittzeit ${calc.totalCuttingTimeMin.toFixed(2)} min + Werkzeugwechsel ${calc.toolChangeAllowanceMin.toFixed(2)} min)`,
      ragSources: [...sources],
    },
    recommendations,
  };
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

async function startServer() {
  const app = express();

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Online mode: Firebase Hosting frontend calls through a tunnel — allow
  // cross-origin and require the shared key for the expensive endpoint.
  const APP_KEY = process.env.APP_KEY || "";
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-app-key");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });
  app.use("/api/chat", (req, res, next) => {
    if (APP_KEY && req.headers["x-app-key"] !== APP_KEY) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  });

  // Live system status for the header chips.
  app.get(["/api/status", "/health"], async (_req, res) => {
    let rag = false;
    let llm = false;
    try {
      const r = await fetch(`${RAG_API_URL}/health`, { signal: AbortSignal.timeout(2000) });
      rag = r.ok && (await r.json()).engine_loaded === true;
    } catch { /* offline */ }
    try {
      const r = await fetch(`${LMSTUDIO_URL}/models`, { signal: AbortSignal.timeout(2000) });
      llm = r.ok;
    } catch { /* offline */ }
    res.json({ model: MODEL_ID, ragOnline: rag, llmOnline: llm });
  });

  // Streaming endpoint: NDJSON pipeline events, final line carries the result.
  app.post("/api/chat", async (req, res) => {
    console.log(`[API] /api/chat (model=${MODEL_ID}, rag=${RAG_API_URL})`);
    const { messages } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: "messages missing" });
      return;
    }
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Accel-Buffering", "no");
    const emit = (event: object) => {
      res.write(JSON.stringify(event) + "\n");
      (res as any).flush?.();
    };
    try {
      const result = await runPipeline(messages, emit);
      emit({ type: "result", data: result });
    } catch (error: any) {
      console.error("Pipeline error:", error);
      emit({ type: "error", error: error.message || "Failed to generate response" });
    }
    res.end();
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
  server.setTimeout(LLM_TIMEOUT_MS * 2);
}

startServer();
