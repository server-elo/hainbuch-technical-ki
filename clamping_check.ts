/**
 * Deterministic clamping-force sanity check ("Spannkraft-Ampel").
 *
 * Estimates the max cutting force from the CALCULATED operations (Kienzle
 * mean-kc approach), derives the required clamping force with stated safety
 * assumptions, and compares it against the catalogue holding force of each
 * recommended product. Everything is a labeled guide value — the goal is a
 * passt/knapp/zu-klein traffic light, not a certified layout.
 */

export interface CheckOperation {
  stepName: string;
  operationType: string;
  diameterMm?: number;
  apMm?: number;
  aeMm?: number;
  /** feed per rev (drehen) in mm/U */
  feedUsed?: number;
  feedUnit?: string;
  feedRateMmPerMin?: number;
  vcUsed?: number;
}

export interface ClampProduct {
  product: string;
  catalogForceKn: number | null;
}

export type Verdict = "passt" | "knapp" | "zu klein" | "unbekannt";

export interface ClampingCheck {
  maxCuttingForceN: number;
  decisiveOp: string;
  requiredClampForceKn: number;
  safetyFactor: number;
  frictionCoeff: number;
  kcUsed: number;
  products: Array<{ product: string; catalogForceKn: number | null; ratio: number | null; verdict: Verdict }>;
  note: string;
}

/** Chip-thickness grid of the Fachkunde table (h in mm). */
export const H_GRID = [0.1, 0.16, 0.3, 0.5, 0.8];

/** kc rows straight from Fachkunde Metall, Tabelle 1 „Richtwerte für die
 *  spez. Schnittkraft kc beim Drehen“ (N/mm² at h = 0,1 / 0,16 / 0,3 / 0,5 / 0,8). */
export const KC_TABLE: Record<string, { row: number[]; source: string }> = {
  baustahl: { row: [2995, 2600, 2130, 1845, 1605], source: "Fachkunde Tab. 1, E295" },
  verguetungsstahl: { row: [2700, 2380, 1990, 1750, 1540], source: "Fachkunde Tab. 1, C35E" },
  automatenstahl: { row: [1985, 1820, 1615, 1485, 1365], source: "Fachkunde Tab. 1, 9SMn28" },
  einsatzstahl: { row: [2795, 2425, 1990, 1725, 1495], source: "Fachkunde Tab. 1, 16MnCr5" },
};

/** Material groups the Fachkunde table doesn't cover — flat guide values. */
export const KC_FLAT: Record<string, number> = {
  edelstahl: 2600,
  gusseisen: 1300,
  aluminium: 800,
  messing: 1000,
  kupfer: 1200,
  titan: 2200,
  kunststoff: 300,
};

/** kc for a material at chip thickness h — linear interpolation on the
 *  Fachkunde grid, clamped to its ends; flat guide value otherwise. */
export function kcFor(materialKey: string, h: number): { kc: number; source: string } | null {
  const t = KC_TABLE[materialKey];
  if (t) {
    const hc = Math.min(Math.max(h, H_GRID[0]), H_GRID[H_GRID.length - 1]);
    for (let i = 0; i < H_GRID.length - 1; i++) {
      if (hc <= H_GRID[i + 1]) {
        const f = (hc - H_GRID[i]) / (H_GRID[i + 1] - H_GRID[i]);
        return { kc: t.row[i] + f * (t.row[i + 1] - t.row[i]), source: t.source };
      }
    }
    return { kc: t.row[t.row.length - 1], source: t.source };
  }
  const flat = KC_FLAT[materialKey];
  return flat ? { kc: flat, source: "Richtwert (nicht in Fachkunde-Tabelle)" } : null;
}

const SAFETY = 2.0; // Sz — dynamic effects, wear, interruption of cut
// µ jaw/workpiece: Fachkunde Tabelle 1 „Reibungszahlen“, Stahl auf Stahl,
// trocken, Haftreibung → 0,2 (conservative vs. serrated jaws, which grip better).
const FRICTION = 0.2;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
const r1 = (v: number) => Math.round(v * 10) / 10;

/** Cutting force of one operation in N with the kc actually used (0 when not computable). */
export function cuttingForceN(
  op: CheckOperation,
  materialKey: string
): { force: number; kc: number; h: number; source: string } {
  const none = { force: 0, kc: 0, h: 0, source: "" };
  const D = Math.max(0.5, op.diameterMm || 10);
  if (op.operationType === "drehen") {
    // Fc = kc(h) · ap · f — h = f (κ = 90°, konservativ: kleineres h → höheres kc)
    const ap = clamp(op.apMm ?? 2.5, 0.5, 5);
    const f = op.feedUsed ?? 0.2;
    const k = kcFor(materialKey, f);
    if (!k) return none;
    return { force: k.kc * ap * f, kc: k.kc, h: f, source: k.source };
  }
  if (op.operationType === "fräsen") {
    // via cutting power: Pc [kW] = Q [cm³/min]·kc/60000 → Fc = Q·kc/vc.
    // Mean chip thickness hm ≈ fz·√(ae/D) picks the kc row (Fachkunde grid).
    const ap = clamp(op.apMm ?? 0.6 * D, 0.2, 1.5 * D);
    const ae = clamp(op.aeMm ?? 0.5 * D, 0.1 * D, D);
    const vf = op.feedRateMmPerMin ?? 0;
    const vc = op.vcUsed ?? 0;
    if (!vf || !vc) return none;
    const fz = op.feedUsed ?? 0.1;
    const hm = clamp(fz * Math.sqrt(ae / D), 0.05, 0.8);
    const k = kcFor(materialKey, hm);
    if (!k) return none;
    const qCm3 = (ap * ae * vf) / 1000;
    return { force: (qCm3 * k.kc) / vc, kc: k.kc, h: hm, source: k.source };
  }
  return none; // drilling/tapping forces are axial — not the clamping-critical case here
}

/** Power limit per Fachkunde: Pe = Fc·vc/η. Returns the factor by which an
 *  operation's time grows when the machine's cutting power can't sustain the
 *  planned removal rate (1 = no limit). availableKw = motor kW × η. */
export function powerLimitFactor(
  op: CheckOperation,
  materialKey: string,
  availableCuttingKw: number
): number {
  if (op.operationType !== "fräsen" && op.operationType !== "drehen") return 1;
  const r = cuttingForceN(op, materialKey);
  const vc = op.vcUsed ?? 0;
  if (!r.force || !vc || availableCuttingKw <= 0) return 1;
  const pcNeededKw = (r.force * vc) / 60000;
  return pcNeededKw > availableCuttingKw ? pcNeededKw / availableCuttingKw : 1;
}

export function checkClamping(
  ops: CheckOperation[],
  materialKey: string,
  products: ClampProduct[]
): ClampingCheck | null {
  if (products.length === 0) return null;
  let maxF = 0;
  let decisive = "";
  let kcUsed = 0;
  let kcSource = "";
  for (const op of ops) {
    const r = cuttingForceN(op, materialKey);
    if (r.force > maxF) {
      maxF = r.force;
      decisive = op.stepName;
      kcUsed = Math.round(r.kc);
      kcSource = r.source;
    }
  }
  if (maxF <= 0) return null;
  const kc = kcUsed;
  const requiredKn = (maxF * SAFETY) / FRICTION / 1000;

  const rows = products.map((p) => {
    if (p.catalogForceKn === null || !Number.isFinite(p.catalogForceKn)) {
      return { product: p.product, catalogForceKn: null, ratio: null, verdict: "unbekannt" as Verdict };
    }
    const ratio = p.catalogForceKn / requiredKn;
    const verdict: Verdict = ratio >= 1.5 ? "passt" : ratio >= 1.0 ? "knapp" : "zu klein";
    return { product: p.product, catalogForceKn: p.catalogForceKn, ratio: r1(ratio), verdict };
  });

  const note =
    `Grobe Abschätzung: kc ≈ ${kc} N/mm² (${kcSource}), maßgebende Operation „${decisive}“ ` +
    `mit Fc ≈ ${Math.round(maxF)} N. Erforderliche Spannkraft = Fc × Sz ${SAFETY} / µ ${FRICTION} ` +
    `(µ nach Fachkunde Reibungszahlen-Tabelle, Stahl/Stahl trocken, Haftreibung) ` +
    `≈ ${r1(requiredKn)} kN. Ampel: ≥150 % passt, 100–150 % knapp, <100 % zu klein. ` +
    `Ersetzt keine Spannkraftmessung (z. B. mit TESTit) und keine Auslegung nach VDI 3106.`;

  return {
    maxCuttingForceN: Math.round(maxF),
    decisiveOp: decisive,
    requiredClampForceKn: r1(requiredKn),
    safetyFactor: SAFETY,
    frictionCoeff: FRICTION,
    kcUsed: kc,
    products: rows,
    note,
  };
}
