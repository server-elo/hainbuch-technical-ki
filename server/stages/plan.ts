import { MATERIALS, cuttingDataPromptTable } from "../machining";
import { llmJson, type OpenAiMessage } from "../llm";
import { ragRetrieve } from "../rag";
import { PlanStageSchema } from "../schemas";
import type { EmitFn } from "../drawing";
import type { ImagePart } from "./messages";
import type { MaterialStage } from "./material";

/** Stage 2: operation plan + Hainbuch workholding (grounded in catalogue). */
export async function buildPlan(args: {
  material: MaterialStage;
  materialRagContext: string;
  conversation: string;
  drawingBlock: string;
  images: ImagePart[];
  germanQuery: string;
  answerLang: string;
  emit: EmitFn;
}) {
  const { material, materialRagContext, conversation, drawingBlock, images, germanQuery, answerLang, emit } = args;

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
      : `Hainbuch Spannmittel Spannfutter für: ${germanQuery || conversation.slice(-800)} Werkstoff ${material.materialName} Rohmaterial ${material.rawStock.form} ${material.rawStock.dimensions}`,
    ["hainbuch_katalog_de", "hainbuch_catalogue"],
    5
  );

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
      ? "WICHTIG — TEILEFORM: Das Rohmaterial ist ein BLOCK → prismatisches FRÄSTEIL auf Fräsmaschine/BAZ. Es gibt KEIN Drehen in diesem Arbeitsplan. Spannmittel: Zentrischspanner / Maschinenschraubstock (z.B. InoFlex). Verwende für Flachmaterial KEINE Spannköpfe wie MANOK, TOROK oder HYDROK."
      : "TEILEFORM: Rotationsteil (Rundmaterial) → Drehen zuerst; Spannmittel: Futter/Spannzange (TOPlus, SPANNTOP) für Außenspannung, Spanndorn (MANDO) für Innenspannung."
  }


=== FERTIGUNGSSTRATEGIE & TOLERANZEN (PROFI) ===
1. ZIELMAßE: Bei asymmetrischen Toleranzen (z.B. +0,40/+0,25) MUSS das Zielmaß zwingend in der Mitte des Toleranzfeldes berechnet werden (z.B. 4,92 mm). Fräse niemals auf das Nennmaß.
2. HÄRTEN & HARTBEARBEITUNG: Bei Werkzeugstahl ≥ 45 HRC und Form-/Lagetoleranzen ≤ 0,01 mm auf Bezugsflächen gibt es zwei gleichwertige Profi-Pfade:
   - Pfad A (Standard, prozesssicher): Weichfräsen mit 0,3–0,5 mm Aufmaß → Härten → Flachschleifen auf Toleranzmitte (intern oder extern).
   - Pfad B (Ein-Maschinen-Profi): Weichfräsen mit Aufmaß → Härten → Hart-Planfräsen / CBN-Schlichten (ap ≤ 0,05–0,1 mm, CBN-Werkzeug) auf Toleranzmitte. Nur auf thermisch stabiler HSC/5-Achs-Maschine mit Magnetspannplatte oder vakuumgestützter Aufnahme. Messprotokoll für Ebenheit/Parallelität zwingend.
3. AUFSPANNUNGEN: Seitliche Features (z.B. horizontales M3-Abziehgewinde) erfordern zwingend eine separate Aufspannung (hochkant) VOR dem Härten.

Erstelle den Arbeitsplan (Reihenfolge nach Analyse: Fräsen/Drehen/Bohren/Senken/Reiben/Gewindebohren).
WICHTIG — VOLLSTÄNDIGE PROZESSKETTE: Fordert die Zeichnung eine HÄRTE (HRC-Angabe, Einsatzhärten, vergütet) oder enge Form-/Lagetoleranzen (< 0,02 mm), dann plane die komplette Kette als eigene Arbeitsgänge:
- operationType "härten" NACH der Weichbearbeitung (stepName z. B. "Härten auf 50+4 HRC (Fremdvergabe)"; diameterMm/cutLengthMm/passes = 1, vcSuggested/feedSuggested = 1 als Platzhalter)
- operationType "schleifen" für die Endbearbeitung toleranzkritischer Flächen nach dem Härten (stepName mit Zielmaß, z. B. "Flachschleifen auf 4,925 ±0,075")
- Gewinde und alle Bohrungen IMMER vor dem Härten.
Diese Schritte erscheinen im Plan, zählen aber nicht zur Maschinenzeit (der Server kennzeichnet sie).
WICHTIG — HARTE REGEL: Bevor du mit dem Arbeitsplan beginnst, prüfe ob alle kritischen Maße vorhanden sind. Bei prismatischen Teilen ist die DICKe / Materialstärke zwingend erforderlich. Fehlt sie in der Zeichnung → du MUSST SOFORT den User fragen und darfst KEINEN Plan erstellen.

Du gibst NUR die Planungsdaten an (Werkzeug, Durchmesser, Zähnezahl, Schnittweg, Anzahl Schnitte, vc, f/fz aus den Richtwerten). Drehzahl, Vorschubgeschwindigkeit und Zeiten werden NICHT von dir berechnet — das macht der Server deterministisch nach ISO-Formeln.
Bei SCHRUPP-Operationen (großer Materialabtrag): gib zusätzlich removalVolumeCm3 an (abzutragendes Volumen = Rohteil minus Fertigkontur für diesen Schritt) sowie ap/ae — der Server erzwingt daraus die physikalisch mögliche Mindestzeit.
Bei mehreren gleichen Bohrungen: passes = Anzahl der Bohrungen.

${cuttingDataPromptTable(material.materialKey)}

Empfehle Spannmittel NUR aus diesem Katalogauszug (mit echten Baugrößen/Spannbereichen). Wenn der Auszug nichts Passendes enthält, sage das ehrlich:
${clampRag.context ? clampRag.context.slice(0, 8000) : "(Katalog nicht verfügbar — nenne Produktfamilien nur allgemein: TOPlus, SPANNTOP, MANDO, MANOK, TOROK)"}
${
    materialRagContext
      ? `\nTOLERANZ-/WERKSTOFF-AUSZÜGE (Passungswerte hieraus EXAKT übernehmen, nie selbst rechnen):\n${materialRagContext.slice(0, 5000)}`
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
        : conversation + drawingBlock,
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
  return { plan, clampRag };
}
