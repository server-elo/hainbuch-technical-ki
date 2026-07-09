/**
 * Deterministic machining-time calculator (Hauptzeit) using standard
 * ISO/Tabellenbuch formulas. The LLM only PLANS operations (type, tool,
 * lengths, passes) and may suggest cutting values; every number here is
 * computed in code and clamped to material Richtwerte — never taken from
 * the model.
 *
 * Formulas:
 *   n  = (vc * 1000) / (π * D)          [1/min]
 *   Drehen/Bohren/Senken/Reiben:  vf = n * f        t = L_total / vf
 *   Fräsen:                       vf = n * z * fz   t = L_total / vf
 *   Gewindebohren:                vf = n * P        t = 2 * l / vf  (in + out)
 */

export type OperationType =
  | "drehen"
  | "fräsen"
  | "bohren"
  | "senken"
  | "reiben"
  | "gewindebohren"
  | "gewindedrehen";

export interface CuttingRange {
  min: number;
  max: number;
  default: number;
}

interface MaterialCuttingData {
  label: string;
  examples: string;
  /** vc in m/min per operation (carbide for drehen/fräsen, VHM for bohren).
   *  gewindedrehen is not stored: derived from drehen per Fachkunde rule
   *  (≈ 25 % niedriger, HM nicht unter 40 m/min) — see threadTurningVcRange. */
  vc: Record<Exclude<OperationType, "gewindedrehen">, CuttingRange>;
  /** feed: f in mm/U (drehen, bohren, senken, reiben) */
  f: Record<Exclude<OperationType, "fräsen" | "gewindebohren" | "gewindedrehen">, CuttingRange>;
  /** fz in mm/tooth for milling */
  fz: CuttingRange;
  /** citation per operation type when the range comes from the Fachkunde */
  sources?: Partial<Record<OperationType | "fz", string>>;
}

const R = (min: number, max: number, def: number): CuttingRange => ({
  min,
  max,
  default: def,
});

export const MATERIALS: Record<string, MaterialCuttingData> = {
  automatenstahl: {
    label: "Automatenstahl",
    examples: "11SMn30, 9SMn28",
    vc: {
      drehen: R(180, 320, 240),
      fräsen: R(120, 250, 180),
      bohren: R(60, 120, 90),
      senken: R(30, 60, 45),
      reiben: R(8, 20, 12),
      gewindebohren: R(5, 20, 10),
    },
    f: {
      drehen: R(0.05, 0.4, 0.25),
      bohren: R(0.05, 0.35, 0.2),
      senken: R(0.08, 0.25, 0.15),
      reiben: R(0.2, 0.6, 0.4),
    },
    fz: R(0.04, 0.18, 0.1),
  },
  baustahl: {
    label: "Baustahl",
    examples: "S235JR, S355J2, E295",
    vc: {
      drehen: R(200, 440, 300),
      fräsen: R(100, 450, 220),
      bohren: R(30, 40, 40), // HSS blank 30–35, HSS beschichtet 40 (Stahl Rm ≤ 800)
      senken: R(25, 55, 40),
      reiben: R(6, 16, 10),
      gewindebohren: R(10, 16, 16), // unlegiert Rm ≤ 700: vc 16
    },
    f: {
      drehen: R(0.1, 0.8, 0.3),
      bohren: R(0.08, 0.32, 0.18), // f nach Bohrer-Ø (4–25 mm): 0,08–0,32
      senken: R(0.08, 0.25, 0.15),
      reiben: R(0.2, 0.6, 0.4),
    },
    fz: R(0.1, 0.4, 0.15),
    sources: {
      drehen: "Fachkunde Tab. 1/2 Drehen (unlegierter Stahl, HM besch.)",
      fräsen: "Fachkunde Tab. 1 Fräsen (HM, unlegierter Stahl)",
      fz: "Fachkunde Tab. 1 Fräsen (HM, unlegierter Stahl)",
      bohren: "Fachkunde Tab. 1 Spiralbohrer (HSS besch., Stahl Rm ≤ 800: vc 40; HSS blank 30–35)",
      gewindebohren: "Fachkunde Tab. 2 HSS-Gewindebohrer (unleg. Stahl ≤ 700 N/mm²: vc 16)",
    },
  },
  verguetungsstahl: {
    label: "Vergütungsstahl",
    examples: "C45, C60, 42CrMo4",
    vc: {
      drehen: R(115, 380, 240),
      fräsen: R(100, 350, 180),
      bohren: R(20, 40, 25), // HSS: Rm ≤ 800: 40 (besch.) / 20–25 (blank >700); Rm > 800: 20
      senken: R(20, 50, 35),
      reiben: R(5, 14, 8),
      gewindebohren: R(8, 12, 10), // unleg. > 700 bzw. legiert ≤ 1000: vc 10
    },
    f: {
      drehen: R(0.1, 0.8, 0.25),
      bohren: R(0.08, 0.28, 0.12), // f nach Bohrer-Ø: >800 N/mm² 0,08–0,15; ≤800 bis 0,28
      senken: R(0.08, 0.2, 0.12),
      reiben: R(0.2, 0.5, 0.3),
    },
    fz: R(0.1, 0.25, 0.12),
    sources: {
      drehen: "Fachkunde Tab. 1/2 Drehen (unleg. C≥0,35 % / niedrigleg.)",
      fräsen: "Fachkunde Tab. 1 Fräsen (HM, legierter Stahl)",
      fz: "Fachkunde Tab. 1 Fräsen (HM, legierter Stahl)",
      bohren: "Fachkunde Tab. 1 Spiralbohrer (HSS, Stähle 700–1000 N/mm²: vc 20–25; Beispiel 34Cr4: vc 20, f 0,12)",
      gewindebohren: "Fachkunde Tab. 2 HSS-Gewindebohrer (leg. Stahl ≤ 1000 N/mm²: vc 10)",
    },
  },
  edelstahl: {
    label: "Nichtrostender Stahl",
    examples: "X5CrNi18-10 (1.4301), 1.4404",
    vc: {
      drehen: R(95, 240, 160),
      fräsen: R(50, 120, 80),
      bohren: R(10, 15, 12), // nichtrostend: vc 12 (HSS besch.)
      senken: R(12, 30, 20),
      reiben: R(4, 10, 6),
      gewindebohren: R(3, 10, 5),
    },
    f: {
      drehen: R(0.05, 0.3, 0.18),
      bohren: R(0.06, 0.12, 0.08), // f nach Bohrer-Ø: 0,06–0,12
      senken: R(0.06, 0.18, 0.1),
      reiben: R(0.15, 0.4, 0.25),
    },
    fz: R(0.03, 0.12, 0.06),
    sources: {
      drehen: "Fachkunde Tab. 1/2 Drehen (hochlegiert, geglüht)",
      bohren: "Fachkunde Tab. 1 Spiralbohrer (HSS besch., nichtrostende Stähle: vc 12)",
    },
  },
  gusseisen: {
    label: "Gusseisen",
    examples: "EN-GJL-250, EN-GJS-400",
    vc: {
      drehen: R(100, 220, 150),
      fräsen: R(100, 300, 150),
      bohren: R(15, 25, 20), // Gusseisen ≤ 250 HB: vc 20 (HSS besch.)
      senken: R(20, 50, 35),
      reiben: R(6, 15, 10),
      gewindebohren: R(5, 15, 8),
    },
    f: {
      drehen: R(0.1, 0.5, 0.3),
      bohren: R(0.2, 0.4, 0.3), // f nach Bohrer-Ø: 0,20–0,40
      senken: R(0.1, 0.3, 0.18),
      reiben: R(0.2, 0.6, 0.4),
    },
    fz: R(0.1, 0.3, 0.15),
    sources: {
      fräsen: "Fachkunde Tab. 1 Fräsen (HM, Gusseisen)",
      fz: "Fachkunde Tab. 1 Fräsen (HM, Gusseisen)",
      bohren: "Fachkunde Tab. 1 Spiralbohrer (HSS besch., Gusseisen ≤ 250 HB: vc 20)",
    },
  },
  aluminium: {
    label: "Aluminiumlegierung",
    examples: "AlMgSi1, AlCuMgPb, EN AW-7075",
    vc: {
      drehen: R(250, 800, 400),
      fräsen: R(200, 600, 300),
      bohren: R(35, 55, 45), // Al-Legierung Rm ≤ 350: vc 45 (HSS besch.)
      senken: R(40, 120, 75),
      reiben: R(10, 30, 20),
      gewindebohren: R(10, 30, 20),
    },
    f: {
      drehen: R(0.05, 0.5, 0.25),
      bohren: R(0.2, 0.4, 0.3), // f nach Bohrer-Ø: 0,20–0,40
      senken: R(0.1, 0.3, 0.2),
      reiben: R(0.2, 0.8, 0.5),
    },
    fz: R(0.05, 0.25, 0.12),
    sources: {
      bohren: "Fachkunde Tab. 1 Spiralbohrer (HSS besch., Al-Legierung Rm ≤ 350: vc 45)",
    },
  },
  messing: {
    label: "Messing",
    examples: "CuZn39Pb3, CuZn37",
    vc: {
      drehen: R(200, 500, 300),
      fräsen: R(150, 350, 200),
      bohren: R(60, 160, 100),
      senken: R(30, 80, 50),
      reiben: R(8, 25, 15),
      gewindebohren: R(8, 25, 15),
    },
    f: {
      drehen: R(0.05, 0.4, 0.2),
      bohren: R(0.06, 0.35, 0.2),
      senken: R(0.1, 0.25, 0.15),
      reiben: R(0.2, 0.6, 0.4),
    },
    fz: R(0.04, 0.2, 0.1),
  },
  kupfer: {
    label: "Kupfer",
    examples: "E-Cu57, CuCrZr",
    vc: {
      drehen: R(150, 350, 200),
      fräsen: R(100, 250, 150),
      bohren: R(50, 120, 80),
      senken: R(25, 60, 40),
      reiben: R(8, 20, 12),
      gewindebohren: R(6, 20, 12),
    },
    f: {
      drehen: R(0.05, 0.35, 0.2),
      bohren: R(0.05, 0.3, 0.15),
      senken: R(0.08, 0.2, 0.12),
      reiben: R(0.2, 0.5, 0.3),
    },
    fz: R(0.04, 0.15, 0.08),
  },
  titan: {
    label: "Titanlegierung",
    examples: "Ti6Al4V (3.7165)",
    vc: {
      drehen: R(30, 80, 50),
      fräsen: R(25, 60, 40),
      bohren: R(10, 30, 20),
      senken: R(5, 15, 10),
      reiben: R(2, 8, 5),
      gewindebohren: R(2, 8, 4),
    },
    f: {
      drehen: R(0.05, 0.25, 0.15),
      bohren: R(0.03, 0.15, 0.08),
      senken: R(0.05, 0.12, 0.08),
      reiben: R(0.1, 0.3, 0.2),
    },
    fz: R(0.02, 0.1, 0.05),
  },
  kunststoff: {
    label: "Kunststoff",
    examples: "POM-C, PA6, PEEK",
    vc: {
      drehen: R(200, 500, 300),
      fräsen: R(150, 400, 250),
      bohren: R(50, 150, 100),
      senken: R(25, 75, 50),
      reiben: R(10, 30, 20),
      gewindebohren: R(10, 30, 20),
    },
    f: {
      drehen: R(0.05, 0.5, 0.2),
      bohren: R(0.1, 0.4, 0.2),
      senken: R(0.1, 0.3, 0.15),
      reiben: R(0.2, 0.6, 0.4),
    },
    fz: R(0.05, 0.3, 0.15),
  },
};

export const MATERIAL_KEYS = Object.keys(MATERIALS);

/** What the LLM is allowed to specify for one operation. */
export interface PlannedOperation {
  stepName: string;
  operationType: OperationType;
  tool: string;
  /** Effective tool/workpiece diameter in mm (tool D for fräsen/bohren, workpiece D for drehen) */
  diameterMm: number;
  /** Number of teeth (fräsen only) */
  teeth?: number;
  /** Total cutting path length in mm for ONE pass */
  cutLengthMm: number;
  /** Number of passes (Schnitte/Zustellungen) */
  passes?: number;
  /** Thread pitch in mm (gewindebohren only) */
  threadPitchMm?: number;
  /** Optional LLM-suggested cutting values — clamped to material table */
  vcSuggested?: number;
  feedSuggested?: number;
  /** Roughing plausibility (fräsen/drehen): removal volume in cm³ */
  removalVolumeCm3?: number;
  /** axial depth of cut in mm (clamped) */
  apMm?: number;
  /** radial width of cut in mm (clamped, fräsen only) */
  aeMm?: number;
  notes?: string;
}

export interface CalculatedOperation extends PlannedOperation {
  vcUsed: number;
  feedUsed: number;
  feedUnit: "mm/U" | "mm/Zahn";
  spindleSpeedRpm: number;
  feedRateMmPerMin: number;
  timeMin: number;
  calculation: string;
}

export interface CalculationResult {
  operations: CalculatedOperation[];
  totalCuttingTimeMin: number;
  /** incl. tool-change allowance */
  totalTimeMin: number;
  toolChangeAllowanceMin: number;
  materialKey: string;
  materialLabel: string;
}

const MAX_RPM_DEFAULT = 8000;
const TOOL_CHANGE_MIN = 0.15;

/** Standard metric coarse pitch (DIN 13) by nominal ∅ — models regularly get
 *  pitches wrong, so this beats whatever the LLM suggested (gewindebohren);
 *  for gewindedrehen it is only the fallback when no pitch was planned. */
export const STANDARD_PITCH: Record<number, number> = {
  3: 0.5, 4: 0.7, 5: 0.8, 6: 1.0, 8: 1.25, 10: 1.5,
  12: 1.75, 14: 2.0, 16: 2.0, 18: 2.5, 20: 2.5, 22: 2.5,
  24: 3.0, 27: 3.0, 30: 3.5, 33: 3.5, 36: 4.0, 39: 4.0, 42: 4.5,
};

/** Fachkunde Tab. 1 „Anzahl der Arbeitsgänge beim Drehen von Außengewinden"
 *  (Kap. 3.6.5.9 Gewindedrehen): Durchgänge nach Steigung. Oberhalb des
 *  Tabellenbereichs (P > 1,5) wird mit der mittleren Zustellung der letzten
 *  Tabellenspalte extrapoliert (Gewindetiefe 0,6134·P / (0,92/6) = 4·P). */
export function threadTurningPasses(pitchMm: number): number {
  if (pitchMm <= 0.5) return 4;
  if (pitchMm <= 0.75) return 4;
  if (pitchMm <= 1.0) return 5;
  if (pitchMm <= 1.5) return 6;
  return Math.ceil(4 * pitchMm - 1e-9);
}

/** Fachkunde 3.6.5.9: vc beim Gewindedrehen ≈ 25 % niedriger als beim
 *  Längsdrehen; bei HM-Wendeschneidplatten nicht unter 40 m/min. */
export function threadTurningVcRange(materialKey: string): CuttingRange {
  const mat = MATERIALS[materialKey] ?? MATERIALS.baustahl;
  const derive = (v: number) => Math.max(40, Math.round(v * 0.75));
  const d = mat.vc.drehen;
  return { min: derive(d.min), max: derive(d.max), default: derive(d.default) };
}

function clamp(value: number | undefined, range: CuttingRange): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0)
    return range.default;
  return Math.min(range.max, Math.max(range.min, value));
}

/** Fachkunde Tab. 2 (Nutenfräsen): fz-Erhöhung bei kleiner Schnitttiefe ae.
 *  ae = d/3 → Basis; d/6 → +15 %; d/8 → +30 %; d/10 → +45 %; d/20 → +100 %. */
export function slotFeedFactor(aeMm: number, dMm: number): number {
  if (aeMm <= 0 || dMm <= 0) return 1;
  const r = aeMm / dMm;
  if (r <= 1 / 20) return 2.0;
  if (r <= 1 / 10) return 1.45;
  if (r <= 1 / 8) return 1.3;
  if (r <= 1 / 6) return 1.15;
  return 1;
}

function round(n: number, digits = 1): number {
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}

export function calculateOperation(
  op: PlannedOperation,
  materialKey: string,
  maxRpm: number = MAX_RPM_DEFAULT
): CalculatedOperation {
  const mat = MATERIALS[materialKey] ?? MATERIALS.baustahl;
  const type = op.operationType;
  const D = Math.max(0.5, op.diameterMm || 10);
  const passes = Math.max(1, Math.round(op.passes || 1));
  let passesUsed = passes;
  const L = Math.max(0.1, op.cutLengthMm || 1);

  const vcRange =
    type === "gewindedrehen" ? threadTurningVcRange(materialKey) : mat.vc[type];
  const vc = clamp(op.vcSuggested, vcRange);
  let n = (vc * 1000) / (Math.PI * D);
  const rpmLimited = n > maxRpm;
  n = Math.min(n, maxRpm);

  let feedUsed: number;
  let feedUnit: "mm/U" | "mm/Zahn";
  let vf: number;
  let totalPath: number;
  let formula: string;
  /** effective pitch after DIN-13 correction/fallback (thread ops only) */
  let effectivePitch: number | undefined;

  if (type === "fräsen") {
    const z = Math.max(1, Math.round(op.teeth || 3));
    feedUsed = clamp(op.feedSuggested, mat.fz);
    feedUnit = "mm/Zahn";
    const slotF = op.aeMm ? slotFeedFactor(op.aeMm, D) : 1;
    vf = n * z * feedUsed * slotF;
    // approach/overrun allowance: half tool diameter each side
    totalPath = (L + D) * passes;
    formula =
      `n = (${round(vc)}·1000)/(π·${round(D)}) = ${round(n, 0)} 1/min` +
      (rpmLimited ? ` (auf n_max ${maxRpm} begrenzt)` : "") +
      `; vf = n·z·fz${slotF > 1 ? `·${slotF}` : ""} = ${round(vf, 0)} mm/min` +
      (slotF > 1 ? ` (Nutenfräs-Korrektur +${Math.round((slotF - 1) * 100)} % n. Fachkunde Tab. 2)` : "") +
      `; t = L/vf = (${round(L)}+${round(D)})·${passes}/${round(vf, 0)} = ` +
      `${round(totalPath / vf, 2)} min`;
  } else if (type === "gewindebohren") {
    // Standard metric coarse pitch (DIN 13) by nominal ∅ beats whatever the
    // LLM suggested — models regularly get pitches wrong.
    const P = STANDARD_PITCH[Math.round(D)] ?? Math.max(0.25, op.threadPitchMm || 1.5);
    effectivePitch = P;
    feedUsed = P;
    feedUnit = "mm/U";
    vf = n * P;
    totalPath = 2 * L * passes; // in + out
    formula =
      `n = (${round(vc)}·1000)/(π·${round(D)}) = ${round(n, 0)} 1/min` +
      `; vf = n·P = ${round(n, 0)}·${P} = ${round(vf, 0)} mm/min` +
      `; t = 2·l·i/vf = 2·${round(L)}·${passes}/${round(vf, 0)} = ${round(totalPath / vf, 2)} min`;
  } else if (type === "gewindedrehen") {
    // Thread turning (lathe). Feed = pitch; pass count from the Fachkunde
    // table (Kap. 3.6.5.9), NOT from the LLM. Fine pitches (e.g. M24x1,5)
    // are legitimate on turned parts, so a planned pitch is accepted as-is;
    // only a missing/implausible pitch falls back to DIN-13 coarse.
    const planned = op.threadPitchMm;
    const P =
      planned && planned >= 0.25 && planned <= 8
        ? planned
        : STANDARD_PITCH[Math.round(D)] ?? 1.5;
    effectivePitch = P;
    passesUsed = threadTurningPasses(P);
    feedUsed = P;
    feedUnit = "mm/U";
    vf = n * P;
    totalPath = L * passesUsed;
    formula =
      `n = (${round(vc)}·1000)/(π·${round(D)}) = ${round(n, 0)} 1/min` +
      (rpmLimited ? ` (auf n_max ${maxRpm} begrenzt)` : "") +
      `; vf = n·P = ${round(n, 0)}·${P} = ${round(vf, 0)} mm/min` +
      `; t = i·L/(n·P) = ${passesUsed}·${round(L)}/${round(vf, 0)} = ${round(totalPath / vf, 2)} min` +
      ` — ${passesUsed} Durchgänge n. Fachkunde Tab. 1 (Gewindedrehen)` +
      (P > 1.5 ? " (oberhalb Tabellenbereich: mittlere Zustellung wie P 1,5 extrapoliert)" : "") +
      `; vc 25 % unter Längsdrehen n. Fachkunde`;
  } else {
    // drehen, bohren, senken, reiben — feed per revolution
    feedUsed = clamp(op.feedSuggested, mat.f[type]);
    feedUnit = "mm/U";
    vf = n * feedUsed;
    const approach = type === "bohren" || type === "senken" ? 0.3 * D : 2;
    totalPath = (L + approach) * passes;
    formula =
      `n = (${round(vc)}·1000)/(π·${round(D)}) = ${round(n, 0)} 1/min` +
      (rpmLimited ? ` (auf n_max ${maxRpm} begrenzt)` : "") +
      `; vf = n·f = ${round(n, 0)}·${feedUsed} = ${round(vf, 0)} mm/min` +
      `; t = L/vf = (${round(L)}+${round(approach, 1)})·${passes}/${round(vf, 0)} = ` +
      `${round(totalPath / vf, 2)} min`;
  }

  let timeMin = totalPath / vf;

  // Roughing guard: the stated time can never remove material faster than
  // the physical removal rate Q = ap·ae·vf (milling) / ap·f·vc (turning).
  if (op.removalVolumeCm3 && op.removalVolumeCm3 > 0) {
    const volMm3 = op.removalVolumeCm3 * 1000;
    let qMm3PerMin = 0;
    if (type === "fräsen") {
      const ap = Math.min(Math.max(op.apMm ?? 0.6 * D, 0.2), 1.5 * D);
      const ae = Math.min(Math.max(op.aeMm ?? 0.5 * D, 0.1 * D), D);
      qMm3PerMin = ap * ae * vf;
    } else if (type === "drehen") {
      const ap = Math.min(Math.max(op.apMm ?? 2.5, 0.5), 5);
      qMm3PerMin = ap * feedUsed * vc * 1000; // ap·f·vc
    }
    if (qMm3PerMin > 0) {
      const tVolume = volMm3 / qMm3PerMin;
      if (tVolume > timeMin) {
        timeMin = tVolume;
        formula += `; Volumen-Check: ${op.removalVolumeCm3} cm³ / Q=${round(qMm3PerMin / 1000, 1)} cm³/min → t=${round(tVolume, 2)} min (maßgebend)`;
      }
    }
  }

  const srcKey = type === "fräsen" ? "fräsen" : type;
  const src = mat.sources?.[srcKey as OperationType] ?? (type === "fräsen" ? mat.sources?.fz : undefined);
  if (src) formula += ` — Richtwerte: ${src}`;

  return {
    ...op,
    diameterMm: D,
    passes: passesUsed,
    threadPitchMm: effectivePitch ?? op.threadPitchMm,
    cutLengthMm: L,
    vcUsed: round(vc),
    feedUsed: round(feedUsed, 3),
    feedUnit,
    spindleSpeedRpm: round(n, 0),
    feedRateMmPerMin: round(vf, 0),
    timeMin: round(timeMin, 2),
    calculation: formula,
  };
}

export function calculatePlan(
  operations: PlannedOperation[],
  materialKey: string,
  maxRpm: number = MAX_RPM_DEFAULT
): CalculationResult {
  const mat = MATERIALS[materialKey] ?? MATERIALS.baustahl;
  const calculated = operations.map((op) =>
    calculateOperation(op, materialKey, maxRpm)
  );
  const cutting = calculated.reduce((s, op) => s + op.timeMin, 0);
  const toolChanges = Math.max(0, calculated.length - 1) * TOOL_CHANGE_MIN;
  return {
    operations: calculated,
    totalCuttingTimeMin: round(cutting, 2),
    totalTimeMin: round(cutting + toolChanges, 2),
    toolChangeAllowanceMin: round(toolChanges, 2),
    materialKey: MATERIALS[materialKey] ? materialKey : "baustahl",
    materialLabel: mat.label,
  };
}

/** Compact Richtwert table injected into the LLM prompt so its suggestions
 *  start from realistic values (they get clamped anyway). */
export function cuttingDataPromptTable(materialKey: string): string {
  const mat = MATERIALS[materialKey] ?? MATERIALS.baustahl;
  const rows = (Object.keys(mat.vc) as Array<Exclude<OperationType, "gewindedrehen">>).map((t) => {
    const vc = mat.vc[t];
    const feed =
      t === "fräsen"
        ? `fz ${mat.fz.min}–${mat.fz.max} mm/Zahn`
        : t === "gewindebohren"
          ? "f = Steigung P"
          : `f ${mat.f[t].min}–${mat.f[t].max} mm/U`;
    return `- ${t}: vc ${vc.min}–${vc.max} m/min (Richtwert ${vc.default}), ${feed}`;
  });
  const tt = threadTurningVcRange(materialKey);
  rows.push(
    `- gewindedrehen: vc ${tt.min}–${tt.max} m/min (Richtwert ${tt.default}, 25 % unter Längsdrehen n. Fachkunde), f = Steigung P, Schnittaufteilung n. Fachkunde Tab. 1`
  );
  return `Richtwerte für ${mat.label} (${mat.examples}):\n${rows.join("\n")}`;
}
