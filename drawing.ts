import { z } from "zod";
import sharp from "sharp";

import { llmJson } from "./llm";

export type EmitFn = (event: object) => void;

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
export type DrawingData = z.infer<typeof DrawingSchema>;

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

export async function analyzeDrawing(
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
