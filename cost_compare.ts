/**
 * Deterministic operating-cost comparison between workholding alternatives.
 *
 * Purchase prices are deliberately NOT part of this app (official quote only).
 * What we CAN compute honestly: handling/clamping time per part (guide values
 * by actuation type) × batch size × machine hour rate → cost difference per
 * series, and the break-even statement for the higher-invest alternative.
 * Every assumption is labeled as such in the output.
 */

export type Actuation = "hydraulisch" | "kraftbetätigt" | "manuell" | "unbekannt";

/** Guide values: clamp + release + part handling per piece, in minutes. */
export const CLAMP_MIN_PER_PART: Record<Actuation, number> = {
  hydraulisch: 0.15,
  kraftbetätigt: 0.1, // machine-actuated chuck/mandrel on the spindle
  manuell: 0.75,
  unbekannt: 0.5,
};

const ACTUATION_BY_FAMILY: Array<[RegExp, Actuation]> = [
  [/hydrok/i, "hydraulisch"],
  [/manok|torok|monteq/i, "manuell"],
  [/spanntop|toplus|mando|maxxos|centrex|captex|b-?top|inozet|inoflex|kipptop/i, "kraftbetätigt"],
];

export function actuationOf(product: string): Actuation {
  for (const [re, a] of ACTUATION_BY_FAMILY) if (re.test(product)) return a;
  return "unbekannt";
}

export interface CostAlternative {
  product: string;
  actuation: Actuation;
  clampMinPerPart: number;
  handlingMinSeries: number;
  handlingCostSeriesEur: number;
  extraVsBestEur: number; // handling cost above the cheapest alternative
}

export interface CostComparison {
  batchSize: number;
  hourlyRateEur: number;
  hourlyRateAssumed: boolean;
  alternatives: CostAlternative[];
  /** German summary incl. break-even — deterministic, no LLM */
  note: string;
}

const r0 = (v: number) => Math.round(v);
const r1 = (v: number) => Math.round(v * 10) / 10;

export function compareCosts(
  products: string[],
  batchSize: number,
  hourlyRateEur: number,
  hourlyRateAssumed: boolean
): CostComparison | null {
  if (products.length < 2 || !Number.isFinite(batchSize) || batchSize < 1) return null;
  const alts = products.map((p) => {
    const actuation = actuationOf(p);
    const clamp = CLAMP_MIN_PER_PART[actuation];
    const minSeries = clamp * batchSize;
    return {
      product: p,
      actuation,
      clampMinPerPart: clamp,
      handlingMinSeries: r1(minSeries),
      handlingCostSeriesEur: r0((minSeries / 60) * hourlyRateEur),
      extraVsBestEur: 0,
    };
  });
  const best = Math.min(...alts.map((a) => a.handlingCostSeriesEur));
  for (const a of alts) a.extraVsBestEur = a.handlingCostSeriesEur - best;

  const cheapest = alts.find((a) => a.handlingCostSeriesEur === best)!;
  const worst = [...alts].sort((a, b) => b.extraVsBestEur - a.extraVsBestEur)[0];
  let breakEven = "";
  if (worst.extraVsBestEur > 0) {
    const hours = r1((worst.handlingMinSeries - cheapest.handlingMinSeries) / 60);
    breakEven =
      ` ${cheapest.product} spart gegenüber ${worst.product} ca. ${hours} Maschinenstunde${hours === 1 ? "" : "n"}` +
      ` ≈ ${worst.extraVsBestEur} € Handlingkosten in dieser Serie — die Mehrinvestition lohnt sich, sobald die Preisdifferenz darunter liegt` +
      ` (Folgeserien nicht eingerechnet, verbessern die Rechnung weiter).`;
  }
  const note =
    `Spannzeiten sind Richtwerte je Betätigungsart (manuell ${CLAMP_MIN_PER_PART.manuell} min/Teil, ` +
    `hydraulisch ${CLAMP_MIN_PER_PART.hydraulisch} min/Teil, kraftbetätigt ${CLAMP_MIN_PER_PART.kraftbetätigt} min/Teil). ` +
    `Maschinenstundensatz ${hourlyRateEur} €/h${hourlyRateAssumed ? " (Annahme — nennen Sie Ihren Satz, dann rechne ich exakt)" : ""}. ` +
    `Kaufpreise nur über das offizielle HAINBUCH-Angebot.` +
    breakEven;
  return { batchSize, hourlyRateEur, hourlyRateAssumed, alternatives: alts, note };
}
