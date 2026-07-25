import { compareCosts } from "../cost_compare";
import { HAINBUCH_RE, canonicalProductName, productImageUrl, stripPageRefs } from "../products";
import { ecosystemFor, automationNudge } from "../sales";
import type { MaterialStage } from "./material";

/** Recommendations are workholding only — drop anything that isn't a
 *  HAINBUCH product family, cap at 3, and pin loose LLM wording to the exact
 *  catalogue product name so photos, kN lookups and the name always agree. */
export function normalizeRecommendations(raw: any[]) {
  const seen = new Set<string>();
  return raw
    .filter((r) => HAINBUCH_RE.test(r.product))
    .filter((r) => {
      const key = canonicalProductName(r.product);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 3)
    .map((r) => {
      const product = canonicalProductName(r.product);
      return {
        ...r,
        product,
        description: stripPageRefs(r.description),
        pros: (r.pros ?? []).map(stripPageRefs),
        technicalData: r.technicalData ? stripPageRefs(r.technicalData) : r.technicalData,
        imageUrl: productImageUrl(product),
      };
    });
}

/** Operating-cost comparison, ecosystem accessories and automation nudge —
 *  all deterministic, no purchase prices. */
export function buildSalesLayer(args: {
  recommendations: Array<{ product: string }>;
  plan: { batchSize?: number | null; machineHourlyRateEur?: number | null };
  material: MaterialStage;
}) {
  const { recommendations, plan, material } = args;
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

  // The raw-stock Ø is what the customer actually clamps — it pins the
  // suggested Spannköpfe/Segmentspannbüchsen to real, orderable sizes.
  const clampDia = /Ø\s*(\d+(?:[.,]\d+)?)/.exec(material.rawStock.dimensions);
  const clampDiaMm = clampDia ? parseFloat(clampDia[1].replace(",", ".")) : null;
  // Merge ecosystem across ALL recommended families (dedup by category), so
  // e.g. a stationary vise's Mehrfachspannplatten appear even when the hand
  // chuck is listed first.
  const ecoSeen = new Set<string>();
  const ecosystem = recommendations
    .flatMap((r) => ecosystemFor(r.product, { batchSize, clampDiaMm }))
    .filter((e) => (ecoSeen.has(e.category) ? false : (ecoSeen.add(e.category), true)))
    .slice(0, 4);
  const hasManual = recommendations.some((r) => /manok|torok|manuell|inoflex vd/i.test(r.product));

  return { costComparison, ecosystem, salesNudge: automationNudge(batchSize, hasManual) };
}
