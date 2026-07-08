import { z } from "zod";

import {
  MATERIAL_KEYS,
  MATERIALS,
  calculatePlan,
  cuttingDataPromptTable,
  type PlannedOperation,
} from "./machining";
import { compareCosts } from "./cost_compare";
import { checkClamping, powerLimitFactor } from "./clamping_check";
import { MAX_RPM, RAG_API_URL } from "./config";
import { llmJson, llmText, type OpenAiMessage } from "./llm";
import { ragRetrieve, parseFitSolutions } from "./rag";
import { MaterialStageSchema, PlanStageSchema } from "./schemas";
import { analyzeDrawing, type DrawingData, type EmitFn } from "./drawing";
import { classifyIntent, LANGUAGE_NAMES } from "./intent";
import { HAINBUCH_RE, productForceKn, productImageUrl, stripPageRefs } from "./products";

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

function lastUserDxf(messages: any[]): string | null {
  for (const msg of [...messages].reverse()) {
    if (msg.role !== "user") continue;
    for (const part of msg.parts || []) {
      if (part.inlineData && /dxf/i.test(part.inlineData.mimeType || "")) return part.inlineData.data;
    }
  }
  return null;
}

function lastUserPdf(messages: any[]): string | null {
  for (const msg of [...messages].reverse()) {
    if (msg.role !== "user") continue;
    for (const part of msg.parts || []) {
      if (part.inlineData && /pdf/i.test(part.inlineData.mimeType || "")) return part.inlineData.data;
    }
  }
  return null;
}

export async function runPipeline(messages: any[], emit: EmitFn = () => {}, lastAnalysis: any = null) {
  const conversation = conversationText(messages);
  const images = lastUserImages(messages);
  const sources = new Set<string>();

  // ---- PDF attachment: server-side render pages -> vision images + embedded text ----
  const pdfB64 = lastUserPdf(messages);
  let pdfTextBlock = "";
  if (pdfB64) {
    emit({ type: "status", stage: "drawing", label: "PDF wird verarbeitet…" });
    try {
      const res = await fetch(`${RAG_API_URL}/parse-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ b64: pdfB64 }),
        signal: AbortSignal.timeout(30000),
      });
      const d: any = await res.json();
      if (d.ok) {
        for (const png of (d.pageImagesPng || []).slice(0, 3 - images.length)) {
          images.push({ type: "image_url", image_url: { url: `data:image/png;base64,${png}` } });
        }
        if (d.text) {
          pdfTextBlock =
            `\n\nANGEHÄNGTES PDF (eingebetteter Text, ${d.pageCount} Seiten` +
            (d.pageCount > d.pagesRendered ? `, erste ${d.pagesRendered} verarbeitet` : "") +
            `):\n${d.text}`;
        }
        emit({ type: "info", label: `PDF verarbeitet: ${d.pagesRendered}/${d.pageCount} Seiten` });
      } else {
        emit({ type: "info", label: `PDF nicht lesbar (${d.error})` });
      }
    } catch (e: any) {
      console.warn("[PDF]", e.message);
    }
  }

  // ---- Stage 0: what does the user actually need? ----
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const lastText = (lastUser?.parts || [])
    .map((p: any) => p.text || "")
    .join(" ")
    .trim();

  emit({ type: "status", stage: "intent", label: "Anfrage wird eingeordnet…" });
  const dxfB64 = lastUserDxf(messages);
  const route = await classifyIntent(lastText, images.length > 0 || !!dxfB64 || !!pdfB64, conversation, !!(lastAnalysis?.operations?.length));
  const { intent, language, germanQuery } = route;
  const langName = LANGUAGE_NAMES[language];
  const answerLang =
    language === "de"
      ? "Antworte auf Deutsch. Mische keine anderen Sprachen in die Antwort."
      : `WICHTIG: Antworte AUSSCHLIESSLICH in ${langName} (die Sprache des Kunden) — die GESAMTE Antwort, ohne deutsche Sätze oder Satzteile zu mischen. Nur Produktnamen (TOPlus, SPANNTOP …) und genormte Kurzzeichen (z. B. 22H7) bleiben unverändert.`;
  console.log(`[Pipeline] intent: ${intent}, language: ${language}, affectsPlan: ${route.affectsPlan}`);

  // A calculated plan exists and the message doesn't change it -> answer from
  // the EXISTING numbers. Re-planning would produce a slightly different plan
  // every time (LLM variance) and destroy trust in the calculation.
  if (intent === "fertigung" && !route.affectsPlan && lastAnalysis?.operations?.length) {
    console.log("[Pipeline] answering from existing plan (no re-plan)");
    emit({ type: "status", stage: "chat", label: "Antwort auf Basis des bestehenden Arbeitsplans…" });
    const message = await llmText([
      {
        role: "system",
        content:
          `Du bist der HAINBUCH Technical Advisor. Es existiert bereits ein BERECHNETER Arbeitsplan (JSON unten) — er bleibt unverändert gültig. ` +
          `Beantworte die Kundenfrage konkret auf Basis dieser bestehenden Zahlen. KEINEN neuen Plan erstellen, KEINE Zahlen ändern oder erfinden. ${answerLang}\n\n` +
          `BESTEHENDER PLAN:\n${JSON.stringify(lastAnalysis).slice(0, 6000)}`,
      },
      { role: "user", content: conversation.slice(-3000) },
    ]);
    return { message: stripPageRefs(message), mode: "chat" };
  }

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
    const rag = await ragRetrieve(germanQuery || lastText, null, 6);
    const fitSolutions = parseFitSolutions(rag.context);
    let message = await llmText([
      {
        role: "system",
        content:
          `Du bist der HAINBUCH Technical Advisor. Beantworte die Fachfrage präzise. ${answerLang} ` +
          "ABSOLUTE REGEL: Die Antwort darf NUR aus den mitgelieferten RAG-AUSZÜGEN (HAINBUCH-Katalog + Fachkunde + Technisches Zeichnen) kommen. " +
          "1. Wenn die Information in den Auszügen steht → antworte exakt daraus. Nenne dabei KEINE Seitenzahlen, Kapitelnummern oder Quellenverweise.\n" +
          "2. Wenn die Information NICHT in den Auszügen steht → sage ehrlich, dass die Unterlagen dazu nichts Konkretes enthalten, und stelle SOFORT eine hilfreiche Rückfrage zur Anwendung (Werkstück, Maße, Werkstoff, Stückzahl), damit du eine passende Empfehlung erarbeiten kannst. NIEMALS nur den Satz 'nicht enthalten' als komplette Antwort.\n" +
          "3. Keine Ergänzungen aus dem allgemeinen Modellwissen erlaubt.\n" +
          "4. Passungswerte: nur aus ## FERTIGE LÖSUNG exakt übernehmen." +
          (rag.context ? `\n\nFACHBUCH-AUSZÜGE:\n${rag.context.slice(0, 10000)}` : ""),
      },
      { role: "user", content: conversation.slice(-3000) },
    ]);
    // Documents empty on this topic → fall back to the LLM's general
    // knowledge, clearly marked as researched (not from HAINBUCH documents).
    // Only when the answer is essentially JUST the "not found" statement —
    // a long grounded answer that mentions a side gap must never be replaced.
    const notFound =
      /nicht enthalten|keine (konkreten |näheren )?(Angaben|Informationen|Daten)|liegen mir (dazu )?nicht vor/i;
    // Fire only when the answer OPENS with the not-found statement — a long
    // grounded answer that mentions a side gap later must never be replaced.
    if (notFound.test(message.trim().slice(0, 250))) {
      console.log("[Fachfrage] docs empty — general-knowledge fallback");
      emit({ type: "status", stage: "chat", label: "Unterlagen decken die Frage nicht ab — allgemeine Recherche…" });
      message = await llmText([
        {
          role: "system",
          content:
            `Du bist der HAINBUCH Technical Advisor. Die interne Wissensbasis enthält zu dieser Frage nichts. ` +
            `Beantworte sie jetzt aus deinem allgemeinen technischen Wissen — präzise, mit Zahlen wo möglich. ${answerLang} ` +
            `Beginne mit einem kurzen Hinweis, dass diese Angabe nicht aus den HAINBUCH-Unterlagen stammt, sondern recherchiert ist und geprüft werden sollte. ` +
            `Wenn du es nicht sicher weißt, sage das ehrlich. Schließe mit einer kurzen, passenden Rückfrage zur Anwendung des Kunden.`,
        },
        { role: "user", content: conversation.slice(-3000) },
      ]);
    }
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
    return { message: stripPageRefs(message), mode: "chat", fitSolutions };
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
    const ORDER = ["werkstoff", "stueckzahl", "abmessungen", "maschine"];
    const items = ORDER.filter((m) => route.missingInfo.includes(m));
    const LABELS: Record<string, string> = {
      werkstoff: "Werkstoff (z. B. C45, 1.4301, AlMgSi1 — oder „frei wählbar“)",
      stueckzahl: "Stückzahl / Losgröße (beeinflusst Spannmittel & Strategie)",
      abmessungen: "Hauptabmessungen des Werkstücks (oder Zeichnung anhängen)",
      maschine: `Ihre Maschine bzw. max. Spindeldrehzahl (z. B. 12.000 1/min — bei „unbekannt“ rechne ich mit ${MAX_RPM} 1/min)`,
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

  // ---- Stage 0.5: measure the drawing ----
  let drawingBlock = "";
  let drawingData: DrawingData | null = null;
  if (dxfB64) {
    // DXF = deterministic parsing, no vision uncertainty.
    emit({ type: "status", stage: "drawing", label: "DXF wird exakt geparst…" });
    try {
      const res = await fetch(`${RAG_API_URL}/parse-dxf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ b64: dxfB64 }),
        signal: AbortSignal.timeout(20000),
      });
      const d: any = await res.json();
      if (d.ok) {
        const dims = (d.dimensions || []).map((x: any) => x.text || String(x.value)).slice(0, 60);
        // exact hole centers from CIRCLE entities
        const circles = (d.circles || []).slice(0, 20);
        const circleLine = circles.length
          ? `\nBohrungspositionen (DXF, exakt): ${circles
              .map((h: any) => `Ø${h.d} bei X${h.x} Y${h.y}`)
              .join("; ")}`
          : "";
        drawingBlock =
          `\n\nTECHNISCHE ZEICHNUNG (DXF, deterministisch geparst — verbindlich):` +
          (d.extentsMm ? `\nZeichnungsausdehnung ca. ${d.extentsMm[0]} × ${d.extentsMm[1]} mm (inkl. Bemaßung)` : "") +
          `\nBemaßungen (${dims.length}): ${dims.join(", ") || "keine Bemaßungsobjekte im DXF"}` +
          circleLine;
        emit({ type: "info", label: `DXF geparst: ${dims.length} Bemaßungen, ${circles.length} Bohrungen` });
      } else {
        emit({ type: "info", label: `DXF nicht lesbar (${d.error}) — bitte Maße nennen` });
      }
    } catch (e: any) {
      console.warn("[DXF]", e.message);
    }
  }
  if (!drawingBlock && images.length > 0) {
    emit({ type: "status", stage: "drawing", label: "Zeichnung wird vermessen (Ausschnitte + Maßketten-Prüfung)…" });
    const res = await analyzeDrawing(images, emit);
    if (res) {
      drawingBlock = `\n\n${res.block}`;
      drawingData = res.drawing;
    }
  }
  if (pdfTextBlock) drawingBlock += pdfTextBlock;

  // ---- Stage 1: material selection (grounded in Fachkunde/Tabellenbuch) ----
  console.log("[Pipeline] Stage 1: material selection");
  emit({
    type: "status",
    stage: "retrieval-material",
    label: "Fachkunde & Tabellenbuch werden durchsucht…",
  });
  const materialRag = await ragRetrieve(
    // German query — the knowledge base is German; germanQuery is the translated core request.
    `Werkstoffauswahl Eigenschaften Zerspanbarkeit: ${germanQuery || lastText} ${conversation.slice(-1200)}`,
    ["fachkunde_metall", "fachkunde_lift", "tabellenbuch_metall"],
    4
  );
  materialRag.chunks.forEach((c) => sources.add(`${c.label}: ${c.header.slice(0, 90)}`));

  const materialSystem = `Du bist ein erfahrener Fertigungsingenieur. Wähle den passenden Werkstoff und das Norm-Rohmaterial für das beschriebene Bauteil.
${answerLang} (Gilt für alle Textfelder: geometryAssessment, reasoning.)
Wähle materialKey NUR aus: ${MATERIAL_KEYS.join(", ")}.
Falls der Kunde einen Werkstoff nennt, ordne ihn der passenden Gruppe zu.
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
      : `Hainbuch Spannmittel Spannfutter für: ${germanQuery || conversation.slice(-800)} Werkstoff ${material.materialName} Rohmaterial ${material.rawStock.form} ${material.rawStock.dimensions}`,
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

  // Still no operations → something essential is missing (e.g. the drawing
  // lacks the thickness). Return ONLY the question — never an empty analysis
  // with "0.00 min" cards.
  if (plan.operations.length === 0) {
    console.warn("[Pipeline] plan impossible — asking for missing data instead of empty analysis");
    const askMsg =
      stripPageRefs(plan.message?.trim() || "") ||
      "Für einen korrekten Arbeitsplan fehlt mir noch eine wesentliche Angabe (z. B. ein Maß). Bitte ergänzen Sie die fehlende Information.";
    return {
      message: `${askMsg}\n\n(Gewählter Werkstoff bisher: ${material.materialName} — bleibt gespeichert, sobald Sie die Angabe ergänzen, plane ich sofort weiter.)`,
      mode: "chat",
    };
  }

  // ---- Stage 3: deterministic calculation (no LLM math) ----
  console.log(`[Pipeline] Stage 3: calculating ${plan.operations.length} operations`);
  emit({
    type: "status",
    stage: "calc",
    label: `${plan.operations.length} Operationen werden nach ISO-Formeln berechnet…`,
  });
  // Spindle limit: 1) customer stated an RPM, 2) customer named a machine →
  // research its spec via the LLM's general knowledge, 3) standard assumption.
  let customerRpm =
    typeof plan.maxSpindleSpeedRpm === "number" &&
    plan.maxSpindleSpeedRpm >= 500 &&
    plan.maxSpindleSpeedRpm <= 60000
      ? Math.round(plan.maxSpindleSpeedRpm)
      : null;
  let rpmSource: "kunde" | "recherche" | "annahme" = customerRpm ? "kunde" : "annahme";
  let researchedKw: number | null = null;
  const customerKwEarly =
    typeof plan.machinePowerKw === "number" && plan.machinePowerKw >= 1 && plan.machinePowerKw <= 200;
  if (route.machine && (!customerRpm || !customerKwEarly)) {
    emit({ type: "info", label: `Maschinendaten werden recherchiert: ${route.machine}…` });
    try {
      const spec = (await llmJson(
        [
          {
            role: "system",
            content:
              "Du bist eine Werkzeugmaschinen-Datenbank. Nenne die maximale Drehzahl der Haupt-/Frässpindel der angefragten Maschine laut Herstellerangaben (Standardausführung). Wenn du die Maschine nicht sicher kennst, gib null zurück — NICHT raten.",
          },
          { role: "user", content: `Maschine: ${route.machine}` },
        ],
        z.object({
          maxSpindleRpm: z
            .number()
            .nullable()
            .describe("max. Spindeldrehzahl in 1/min laut Hersteller, sonst null"),
          spindlePowerKw: z
            .number()
            .nullable()
            .describe("Spindelleistung in kW laut Hersteller (Dauerleistung/S1 falls bekannt), sonst null"),
        }),
        "machine_spec"
      )) as { maxSpindleRpm: number | null; spindlePowerKw: number | null };
      if (
        typeof spec.maxSpindleRpm === "number" &&
        spec.maxSpindleRpm >= 500 &&
        spec.maxSpindleRpm <= 60000
      ) {
        customerRpm = Math.round(spec.maxSpindleRpm);
        rpmSource = "recherche";
        emit({ type: "info", label: `${route.machine}: max. ${customerRpm} 1/min (recherchiert)` });
      }
      if (
        typeof spec.spindlePowerKw === "number" &&
        spec.spindlePowerKw >= 1 &&
        spec.spindlePowerKw <= 200
      ) {
        researchedKw = Math.round(spec.spindlePowerKw * 10) / 10;
      }
    } catch (e) {
      console.warn("[Machine] spec lookup failed:", e);
    }
  }
  const calc = calculatePlan(
    plan.operations as PlannedOperation[],
    material.materialKey,
    customerRpm ?? MAX_RPM
  );

  // Leistungs-Untergrenze (Fachkunde: Pe = Fc·vc/η, η = 0,8): Schrupp-Zeiten,
  // die mehr Schnittleistung bräuchten als die Maschine hat, werden angehoben.
  const customerKw =
    typeof plan.machinePowerKw === "number" && plan.machinePowerKw >= 1 && plan.machinePowerKw <= 200
      ? plan.machinePowerKw
      : null;
  const machineKw = customerKw ?? researchedKw ?? 15;
  const kwSource = customerKw ? "kunde" : researchedKw ? "recherche" : "annahme";
  const availableCuttingKw = machineKw * 0.8;
  const powerLimitedOps: string[] = [];
  for (const op of calc.operations) {
    // only ops with real depth evidence (explizite ap/ae, Volumen) oder Schruppen —
    // sonst würde die ap-Default-Annahme Schlichtzeiten künstlich aufblasen
    const roughingEvidence =
      op.apMm !== undefined || op.aeMm !== undefined ||
      (op.removalVolumeCm3 ?? 0) > 0 || /schrupp|rough/i.test(op.stepName);
    if (!roughingEvidence) continue;
    const f = powerLimitFactor(op as any, material.materialKey, availableCuttingKw);
    if (f > 1.05) {
      op.timeMin = Math.round(op.timeMin * f * 100) / 100;
      op.calculation += ` · leistungsbegrenzt auf ${machineKw} kW: Zeit ×${f.toFixed(2)} (Pe = Fc·vc/η, Fachkunde)`;
      powerLimitedOps.push(op.stepName);
    }
  }
  if (powerLimitedOps.length) {
    calc.totalCuttingTimeMin = Math.round(calc.operations.reduce((a, o) => a + o.timeMin, 0) * 100) / 100;
    calc.totalTimeMin = Math.round((calc.totalCuttingTimeMin + calc.toolChangeAllowanceMin) * 100) / 100;
  }

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
  const recommendations = plan.recommendations
    .filter((r) => HAINBUCH_RE.test(r.product))
    .slice(0, 3)
    .map((r) => ({
      ...r,
      description: stripPageRefs(r.description),
      pros: (r.pros ?? []).map(stripPageRefs),
      cons: (r.cons ?? []).map(stripPageRefs),
      technicalData: r.technicalData ? stripPageRefs(r.technicalData) : r.technicalData,
      imageUrl: productImageUrl(r.product),
    }));

  // Spindle limit: state what the calculation used — customer value,
  // researched machine spec, or assumption. Show only if new to the conversation.
  if (rpmSource === "kunde") {
    message += `\n\nDie Schnittdaten sind auf Ihre maximale Spindeldrehzahl von ${customerRpm} 1/min begrenzt.`;
  } else if (rpmSource === "recherche") {
    message += `\n\nFür Ihre ${route.machine} habe ich eine max. Spindeldrehzahl von ${customerRpm} 1/min recherchiert und die Schnittdaten darauf begrenzt — bitte prüfen Sie den Wert an Ihrer Maschine.`;
  } else if (!conversation.includes("Spindeldrehzahl von")) {
    message += `\n\nHinweis: Ohne Angabe zu Ihrer Maschine habe ich mit einer üblichen max. Spindeldrehzahl von ${MAX_RPM} 1/min gerechnet. Nennen Sie mir Ihre Maschine, dann passe ich die Schnittdaten an.`;
  }
  if (powerLimitedOps.length) {
    message +=
      `\n\n⚡ Leistungs-Check (Pe = Fc·vc/η, Fachkunde): ${machineKw} kW ` +
      (kwSource === "kunde" ? "(Ihre Angabe)" : kwSource === "recherche" ? `(recherchiert für ${route.machine} — bitte prüfen)` : "(Annahme — nennen Sie die Spindelleistung Ihrer Maschine)") +
      ` reichen für ${powerLimitedOps.join(", ")} nicht bei vollen Schnittwerten — die Zeiten wurden entsprechend angehoben.`;
  }

  // Operating-cost comparison between the alternatives — deterministic,
  // guide-value clamping times × batch × hour rate. No purchase prices.
  const batchSize =
    typeof plan.batchSize === "number" && plan.batchSize >= 1 && plan.batchSize <= 1_000_000
      ? Math.round(plan.batchSize)
      : null;
  const hourlyRate =
    typeof plan.machineHourlyRateEur === "number" &&
    plan.machineHourlyRateEur >= 20 &&
    plan.machineHourlyRateEur <= 500
      ? plan.machineHourlyRateEur
      : null;
  const costComparison =
    recommendations.length >= 2 && batchSize
      ? compareCosts(
          recommendations.map((r) => r.product),
          batchSize,
          hourlyRate ?? 80,
          hourlyRate === null
        )
      : null;

  // Clamping-force traffic light: estimated cutting force vs. catalogue
  // holding force of each recommended product (labeled guide values).
  const clampingCheck = checkClamping(
    calc.operations,
    material.materialKey,
    recommendations.map((r) => ({ product: r.product, catalogForceKn: productForceKn(r.product) }))
  );

  return {
    message: stripPageRefs(message),
    fitSolutions,
    costComparison,
    clampingCheck,
    manufacturingAnalysis: {
      material: {
        name: material.materialName,
        group: MATERIALS[material.materialKey].label,
        reasoning: stripPageRefs(material.reasoning),
      },
      rawMaterialRecommendation: `${material.rawStock.form} ${material.rawStock.dimensions} (${material.rawStock.norm})`,
      fastestMethod: stripPageRefs(plan.fastestMethod),
      costEffectiveMethod: stripPageRefs(plan.costEffectiveMethod),
      clampingStrategy: plan.clampingStrategy ? stripPageRefs(plan.clampingStrategy) : plan.clampingStrategy,
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
        diameterMm: op.diameterMm,
        cutLengthMm: op.cutLengthMm,
        passes: op.passes,
        threadPitchMm: op.threadPitchMm,
      })),
      totalEstimatedMachiningTime: `${calc.totalTimeMin.toFixed(2)} min (Schnittzeit ${calc.totalCuttingTimeMin.toFixed(2)} min + Werkzeugwechsel ${calc.toolChangeAllowanceMin.toFixed(2)} min)`,
      ragSources: [...sources],
    },
    recommendations,
  };
}
