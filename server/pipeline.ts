import { MATERIALS } from "./machining";
import { checkClamping } from "./clamping_check";
import { parseFitSolutions } from "./rag";
import { analyzeDrawing, type DrawingData, type EmitFn } from "./drawing";
import { classifyIntent, LANGUAGE_NAMES } from "./intent";
import { productForceKn, stripPageRefs } from "./products";
import { localizeNotes } from "./notices";
import {
  conversationText,
  lastUserImages,
  lastUserDxf,
  lastUserPdf,
  lastUserText,
} from "./stages/messages";
import { parsePdfAttachment, parseDxfAttachment } from "./stages/attachments";
import {
  alreadyAskedFor,
  answerFachfrage,
  answerFromExistingPlan,
  answerSmalltalk,
  appendFitBlock,
  askForMissingInfo,
} from "./stages/chat";
import { selectMaterial } from "./stages/material";
import { buildPlan } from "./stages/plan";
import { calculateOperations, machineNotes } from "./stages/calc";
import { buildSalesLayer, normalizeRecommendations } from "./stages/recommendations";

export async function runPipeline(messages: any[], emit: EmitFn = () => {}, lastAnalysis: any = null) {
  const conversation = conversationText(messages);
  const images = lastUserImages(messages);
  const sources = new Set<string>();

  // ---- PDF attachment: server-side render pages -> vision images + embedded text ----
  const pdfB64 = lastUserPdf(messages);
  const pdfTextBlock = pdfB64 ? await parsePdfAttachment(pdfB64, images, emit) : "";

  // ---- Stage 0: what does the user actually need? ----
  const lastText = lastUserText(messages);

  emit({ type: "status", stage: "intent", label: "Anfrage wird eingeordnet…" });
  const dxfB64 = lastUserDxf(messages);
  // Vision drawing analysis is the slowest stage (~30 s) and independent of
  // intent — start it now, in parallel with classification.
  let drawingPromise: ReturnType<typeof analyzeDrawing> | null = null;
  if (images.length > 0 && !dxfB64) {
    emit({ type: "status", stage: "drawing", label: "Zeichnung wird vermessen (Ausschnitte + Maßketten-Prüfung)…" });
    drawingPromise = analyzeDrawing(images, emit).catch((e) => {
      console.warn("[Drawing]", e.message);
      return null;
    });
  }
  // The classifier must see the PDF's embedded text: material/dimensions in
  // the PDF must not trigger redundant clarifying questions.
  const intentText = pdfTextBlock ? `${lastText}\n${pdfTextBlock.slice(0, 1500)}` : lastText;
  const route = await classifyIntent(
    intentText,
    images.length > 0 || !!dxfB64 || !!pdfB64,
    conversation,
    !!(lastAnalysis?.operations?.length)
  );
  const { intent, language, germanQuery } = route;
  const langName = LANGUAGE_NAMES[language];
  const answerLang =
    language === "de"
      ? "Antworte auf Deutsch. Mische keine anderen Sprachen in die Antwort."
      : `WICHTIG: Antworte AUSSCHLIESSLICH in ${langName} (die Sprache des Kunden) — die GESAMTE Antwort, ohne deutsche Sätze oder Satzteile zu mischen. Nur Produktnamen (TOPlus, SPANNTOP …) und genormte Kurzzeichen (z. B. 22H7) bleiben unverändert.`;
  console.log(`[Pipeline] intent: ${intent}, language: ${language}, affectsPlan: ${route.affectsPlan}`);

  if (intent === "fertigung" && !route.affectsPlan && lastAnalysis?.operations?.length) {
    return answerFromExistingPlan(lastAnalysis, conversation, answerLang, emit);
  }
  if (intent === "smalltalk") {
    return answerSmalltalk(conversation, emit);
  }
  if (intent === "fachfrage") {
    return answerFachfrage(germanQuery || lastText, conversation, language, answerLang, emit);
  }

  // ---- Requirements gathering: ask exactly once (marker guard) for missing
  // essentials, in priority order. ----
  const alreadyAsked = alreadyAskedFor(messages);
  if (route.missingInfo.length > 0 && !alreadyAsked) {
    // The drawing often answers "missing" info (material in the title block,
    // dimensions) — await the parallel vision analysis before asking.
    if (drawingPromise) {
      const res = await drawingPromise;
      if (res) {
        if (res.drawing.material) route.missingInfo = route.missingInfo.filter((m) => m !== "werkstoff");
        if (res.drawing.overallDimensionsMm.length)
          route.missingInfo = route.missingInfo.filter((m) => m !== "abmessungen");
      }
    }
    if (route.missingInfo.length > 0) {
      return askForMissingInfo(route.missingInfo, language, langName, emit);
    }
  }

  // ---- Stage 0.5: measure the drawing ----
  let drawingBlock = dxfB64 ? await parseDxfAttachment(dxfB64, emit) : "";
  let drawingData: DrawingData | null = null;
  if (!drawingBlock && drawingPromise) {
    const res = await drawingPromise;
    if (res) {
      drawingBlock = `\n\n${res.block}`;
      drawingData = res.drawing;
    }
  }
  drawingBlock += pdfTextBlock;

  // ---- Stage 1: material ----
  const { material, materialRag } = await selectMaterial({
    conversation,
    drawingBlock,
    drawingData,
    images,
    lastText,
    germanQuery,
    answerLang,
    emit,
  });
  materialRag.chunks.forEach((c) => sources.add(`${c.label}: ${c.header.slice(0, 90)}`));

  // ---- Stage 2: operation plan + workholding ----
  const { plan, clampRag } = await buildPlan({
    material,
    materialRagContext: materialRag.context,
    conversation,
    drawingBlock,
    images,
    germanQuery,
    answerLang,
    emit,
  });
  clampRag.chunks.forEach((c) => sources.add(`${c.label}: ${c.header.slice(0, 90)}`));

  // Still no operations → something essential is missing (e.g. the drawing
  // lacks the thickness). Return ONLY the question — never an empty analysis
  // with "0.00 min" cards.
  if (plan.operations.length === 0) {
    console.warn("[Pipeline] plan impossible — asking for missing data instead of empty analysis");
    const askMsg =
      stripPageRefs(plan.message?.trim() || "") ||
      "Für einen korrekten Arbeitsplan fehlt mir noch eine wesentliche Angabe (z. B. ein Maß). Bitte ergänzen Sie die fehlende Information.";
    const [tail] = await localizeNotes(
      [`(Gewählter Werkstoff bisher: ${material.materialName} — bleibt gespeichert, sobald Sie die Angabe ergänzen, plane ich sofort weiter.)`],
      language
    );
    return { message: `${askMsg}\n\n${tail}`, mode: "chat" as const };
  }

  // ---- Stage 3: deterministic calculation ----
  const { calc, customerRpm, rpmSource, machineKw, kwSource, powerLimitedOps } =
    await calculateOperations({ plan, material, machine: route.machine, emit });

  // Fit questions: append the code-computed ISO 286 solution verbatim so the
  // customer always gets exact values, regardless of LLM message quality.
  const fitSolutions = parseFitSolutions(materialRag.context);
  let message = appendFitBlock(plan.message, materialRag.context, language);

  const recommendations = normalizeRecommendations(plan.recommendations);

  for (const note of await localizeNotes(
    machineNotes({
      rpmSource,
      customerRpm,
      machine: route.machine,
      conversation,
      powerLimitedOps,
      machineKw,
      kwSource,
    }),
    language
  )) {
    message += `\n\n${note}`;
  }

  const { costComparison, ecosystem, salesNudge } = buildSalesLayer({
    recommendations,
    plan,
    material,
  });

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
      totalEstimatedMachiningTime: `${calc.totalTimeMin.toFixed(2)} min Maschinenzeit (Schnittzeit ${calc.totalCuttingTimeMin.toFixed(2)} min + Werkzeugwechsel ${calc.toolChangeAllowanceMin.toFixed(2)} min)` +
        (calc.operations.some((o: any) => o.operationType === "härten" || o.operationType === "schleifen")
          ? " — zzgl. Wärmebehandlung/Schleifen (separate Durchlaufzeit)" : ""),
      ragSources: [...sources],
    },
    recommendations,
    ecosystem,
    salesNudge,
  };
}
