import { MATERIAL_KEYS } from "../machining";
import { llmJson } from "../llm";
import { ragRetrieve } from "../rag";
import { MaterialStageSchema } from "../schemas";
import type { DrawingData, EmitFn } from "../drawing";
import { normalizeRawStock } from "./rawstock";
import type { ImagePart } from "./messages";

export type MaterialStage = Awaited<ReturnType<typeof selectMaterial>>["material"];

/** Stage 1: material selection (grounded in Fachkunde/Tabellenbuch). */
export async function selectMaterial(args: {
  conversation: string;
  drawingBlock: string;
  drawingData: DrawingData | null;
  images: ImagePart[];
  lastText: string;
  germanQuery: string;
  answerLang: string;
  emit: EmitFn;
}) {
  const { conversation, drawingBlock, drawingData, images, lastText, germanQuery, answerLang, emit } = args;

  console.log("[Pipeline] Stage 1: material selection");
  emit({
    type: "status",
    stage: "retrieval-material",
    label: "Fachkunde & Tabellenbuch werden durchsucht…",
  });
  // Tolerance designations from the drawing (22h6, 40H7 …) must reach the
  // RAG API so its deterministic ISO 286 solver produces the exact limits.
  const tolMentions = [
    ...new Set(
      `${lastText} ${drawingBlock}`.match(/\d{1,3}\s*[A-Za-z]{1,2}\d{1,2}(?:\s*\/\s*[A-Za-z]{1,2}\d{1,2})?/g) || []
    ),
  ]
    .slice(0, 6)
    .join(" ");
  const materialRag = await ragRetrieve(
    // German query — the knowledge base is German; germanQuery is the translated core request.
    `Werkstoffauswahl Eigenschaften Zerspanbarkeit: ${germanQuery || lastText} ${tolMentions} ${conversation.slice(-1200)}`,
    ["fachkunde_metall", "fachkunde_lift", "tabellenbuch_metall"],
    4
  );

  const materialSystem = `Du bist ein erfahrener Fertigungsingenieur. Wähle den passenden Werkstoff und das Norm-Rohmaterial für das beschriebene Bauteil.
${answerLang} (Gilt für alle Textfelder: geometryAssessment, reasoning.)
Wähle materialKey NUR aus: ${MATERIAL_KEYS.join(", ")}.
Falls der Kunde einen Werkstoff nennt, ordne ihn der passenden Gruppe zu. Eindeutige Zuordnungen: 1.2842/90MnCrV8/1.2080/1.2379/1.2510 → werkzeugstahl (NICHT verguetungsstahl); 16MnCr5/20MnCr5 → einsatzstahl; C45/C60/42CrMo4 → verguetungsstahl; 1.4301/1.4404/1.4571 → edelstahl.
VORRANG-REGEL: Die NEUESTE Angabe des KUNDEN gewinnt IMMER — auch gegen frühere Annahmen oder Rohmaße aus dem bisherigen Gesprächsverlauf. Liefert der Kunde ein fehlendes Maß nach (z. B. auf Rückfrage „Dicke?" antwortet er „10"), dann ist die Dicke exakt 10 mm und das Rohmaß wird daraus NEU berechnet — alte Assistenten-Werte verwerfen.
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
          : conversation + drawingBlock,
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

  return { material, materialRag };
}
