import { z } from "zod";

import { MATERIAL_KEYS } from "./machining";

// ---------------------------------------------------------------------------
// Stage schemas (zod → JSON schema → LM Studio structured output)
// ---------------------------------------------------------------------------

export const MaterialStageSchema = z.object({
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

export const OperationSchema = z.object({
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
    "gewindedrehen",
    "härten",
    "schleifen",
  ]),
  tool: z
    .string()
    .describe(
      "Realistisches Werkzeug, z.B. 'Drehmeißel mit Wendeplatte CNMG', 'VHM-Schaftfräser D12 z4', 'Spiralbohrer D6,8', 'Kegelsenker 90°', 'Maschinenreibahle D12 H7', 'Gewindebohrer M8', 'Gewindedrehmeißel 60°'"
    ),
  diameterMm: z
    .number()
    .describe("Werkzeug-Ø in mm (Fräsen/Bohren) bzw. Werkstück-Ø (Drehen)"),
  teeth: z.number().optional().describe("Zähnezahl z (nur Fräsen)"),
  cutLengthMm: z.number().describe("Schnittweg in mm für EINEN Schnitt/Durchgang"),
  passes: z.number().describe("Anzahl Schnitte/Durchgänge (auch Anzahl Bohrungen)"),
  threadPitchMm: z.number().optional().describe("Gewindesteigung P in mm (Gewindebohren/Gewindedrehen; bei Feingewinde wie M24x1,5 exakt angeben)"),
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

export const PlanStageSchema = z.object({
  // Generated FIRST (schema order = generation order): forces the model to
  // reason about the geometry before it commits to operations.
  geometryAnalysis: z
    .string()
    .describe(
      "Denke hier Schritt für Schritt, BEVOR du planst: 1) Ist das Werkstück ein Rotationsteil (Drehen) oder ein prismatisches Frästeil (KEIN Drehen)? 2) Welche Features hat es (Bohrungen, Nuten, Radien, Schrägen, Passungen) mit welchen Maßen? Die NEUESTE Kundenangabe hat dabei IMMER Vorrang vor älteren Annahmen im Verlauf (nachgelieferte Dicke/Maße exakt übernehmen). 3) Wie viele Aufspannungen, welche Flächen zuerst? 4) Welches Spannmittel passt zur Teileform? Erst danach die übrigen Felder ausfüllen — sie müssen zu dieser Analyse passen."
    ),
  message: z
    .string()
    .describe(
      "Direkte Antwort AN den Kunden als Hainbuch-Vertriebsingenieur. Beantworte ALLE Fragen des Kunden konkret mit Zahlen — Passungsfragen IMMER mit den exakten Werten aus der FERTIGEN LÖSUNG (P_SH, P_ÜH, Grenzmaße). Keine Meta-Kommentare über den Ablauf. Rückfrage nach Stückzahl nur falls unbekannt. " +
        "WENN EIN WESENTLICHES MASS FEHLT (z. B. Dicke/Länge nicht in Text oder Zeichnung): NIEMALS ein Maß annehmen oder erfinden — operations LEER lassen und in message präzise nachfragen, welches Maß fehlt."
    ),
  fastestMethod: z.string(),
  costEffectiveMethod: z.string(),
  maxSpindleSpeedRpm: z
    .number()
    .nullable()
    .describe(
      "Maximale Spindeldrehzahl der KUNDENMASCHINE in 1/min, falls der Kunde Maschine oder Drehzahl im Gespräch genannt hat (z. B. „DMG 12.000“, „max 6000 U/min“) — sonst null. NICHT raten."
    ),
  batchSize: z
    .number()
    .nullable()
    .describe("Stückzahl/Losgröße als Zahl, falls im Gespräch genannt (z. B. „200 Stück“ → 200) — sonst null. NICHT raten."),
  machinePowerKw: z
    .number()
    .nullable()
    .describe("Spindel-/Antriebsleistung der Kundenmaschine in kW, falls genannt — sonst null. NICHT raten."),
  machineHourlyRateEur: z
    .number()
    .nullable()
    .describe("Maschinenstundensatz in €/h, falls der Kunde ihn genannt hat — sonst null. NICHT raten."),
  clampingStrategy: z.string().describe("Spannstrategie mit konkreten Hainbuch-Produkten aus dem Katalogauszug"),
  viseMachiningPlan: z.string().describe("OP10/OP20 Aufspannungen: was wird wann wie gespannt und bearbeitet"),
  operations: z.array(OperationSchema),
  recommendations: z
    .array(
      z.object({
        product: z
          .string()
          .describe("NUR HAINBUCH-SPANNMITTEL aus dem Katalogauszug (TOPlus, SPANNTOP, MANDO, MANOK, TOROK …). Nenne die Baugröße IM Namen (z. B. „HYDROK SE Größe 100“). KEINE Schneidwerkzeuge (Bohrer/Fräser/Reibahlen gehören in den Arbeitsplan, nicht hierher)."),
        description: z.string().describe("Warum dieses Spannmittel; nenne Baugröße und Spannbereich aus dem Katalog"),
        pros: z
          .array(z.string())
          .describe("2-4 konkrete Vorteile DIESER Lösung für DIESES Werkstück (kurz, je max. 12 Wörter)"),
        technicalData: z
          .string()
          .describe("Relevante Katalogdaten: Spannbereich, Rundlauf, max. Drehzahl, Mat.-Nr. falls im Auszug"),
      })
    )
    .max(3)
    .describe(
      "IMMER 2 bis 3 ALTERNATIVE Spannmittel-Empfehlungen, sortiert nach Eignung — fast immer gibt es eine automatisierbare/kraftbetätigte Option (z. B. SPANNTOP, TOPlus, HYDROK) UND eine manuelle/wirtschaftliche Option (z. B. MANOK, TOROK) für dieselbe Aufgabe. Die Vorteile zeigen, wofür jede Alternative am besten geeignet ist (z. B. ‚ideal für Automatisierung‘ vs. ‚wirtschaftlich bei kleinen Serien‘). Nur wenn wirklich nur EIN Produkt technisch passt, gib eines an. KEINE Preise, KEINE Werkzeuge."
    ),
});
