/** Sales layer: turn a technically correct recommendation into a complete
 *  HAINBUCH package — ecosystem accessories, automation upsell with the
 *  existing amortization logic, and concrete next steps. Suggestions are
 *  grounded in real shop SKUs (assets/products/shop_accessories.json), so the
 *  advisor sells Spannköpfe, Segmentspannbüchsen & Co. by name, not by prose. */

import fs from "node:fs";
import path from "node:path";

export interface EcosystemSuggestion {
  category: string;
  suggestion: string;
  reason: string;
  /** concrete shop SKUs backing the suggestion (name + Mat.-Nr.) */
  products?: { name: string; materialNo: string }[];
}

interface AccessorySku {
  group: string;
  materialNo: string;
  title: string;
  category: string;
  size: string | null;
  clampDiaMm: number | null;
  series: string | null;
  fits: string | null;
  image?: string;
}

const ACCESSORIES: AccessorySku[] = (() => {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "assets/products/shop_accessories.json"), "utf8")
    );
  } catch {
    console.warn("[Sales] assets/products/shop_accessories.json missing — generic suggestions only");
    return [];
  }
})();

const FAMILY = (name: string) => {
  const n = name.toLowerCase();
  if (/toplus|spanntop/.test(n)) return "futter";
  if (/mando|maxxos/.test(n)) return "dorn";
  if (/manok|hydrok|inoflex vf|zentrischspanner|spannstock/.test(n)) return "stationaer";
  if (/torok|inoflex vd/.test(n)) return "handspann";
  if (/b-top|backenfutter/.test(n)) return "backen";
  return "";
};

/** Baugröße named in the recommendation ("TOPlus Größe 65" → "65"). */
function sizeOf(productName: string): string | null {
  const sizes = productName.match(/\b(26|32|40|42|52|65|80|100|125|160|200)\b/g);
  return sizes ? sizes[sizes.length - 1] : null;
}

/** Baureihe: SE (sechseckig) or RD (rund) if the recommendation says so. */
function seriesOf(productName: string): string | null {
  if (/\bSE\b|sechskant|sechseckig/i.test(productName)) return "SE";
  if (/\bRD\b|\brund\b/i.test(productName)) return "RD";
  return null;
}

/** Pick up to `limit` SKUs from a group, narrowed by size/series/clamp Ø. */
function pick(
  group: string,
  opts: { size?: string | null; series?: string | null; clampDiaMm?: number | null; limit?: number } = {}
): AccessorySku[] {
  const { size = null, series = null, clampDiaMm = null, limit = 2 } = opts;
  let pool = ACCESSORIES.filter((a) => a.group === group);
  if (size) {
    const sized = pool.filter((a) => a.size === size);
    if (sized.length) pool = sized;
  }
  if (series) {
    const seriesPool = pool.filter((a) => a.series === series || a.fits?.includes(series));
    if (seriesPool.length) pool = seriesPool;
  }
  if (clampDiaMm && pool.some((a) => a.clampDiaMm !== null)) {
    // Closest clamping diameter first — the raw stock Ø is what the customer clamps.
    pool = pool
      .filter((a) => a.clampDiaMm !== null)
      .sort((a, b) => Math.abs(a.clampDiaMm! - clampDiaMm) - Math.abs(b.clampDiaMm! - clampDiaMm));
  }
  // Same product name in several variants adds no information for the customer.
  const seen = new Set<string>();
  return pool.filter((a) => (seen.has(a.title) ? false : (seen.add(a.title), true))).slice(0, limit);
}

const asProducts = (skus: AccessorySku[]) =>
  skus.map((s) => ({ name: s.title, materialNo: s.materialNo }));

export interface EcosystemContext {
  batchSize: number | null;
  /** raw-stock clamping diameter in mm, when known from the plan */
  clampDiaMm?: number | null;
}

/** Ecosystem: what a HAINBUCH sales engineer always mentions with the family. */
export function ecosystemFor(
  productName: string,
  ctx: EcosystemContext
): EcosystemSuggestion[] {
  const fam = FAMILY(productName);
  const out: EcosystemSuggestion[] = [];
  const big = (ctx.batchSize ?? 0) >= 200;
  const size = sizeOf(productName);
  const series = seriesOf(productName);
  const dia = ctx.clampDiaMm ?? null;

  const withProducts = (s: EcosystemSuggestion, skus: AccessorySku[]) => {
    if (skus.length) s.products = asProducts(skus);
    out.push(s);
  };

  if (fam === "futter" || fam === "handspann" || fam === "stationaer") {
    // Without a clamping Ø any concrete Spannkopf SKU would be arbitrary —
    // then the suggestion stays generic instead of naming a wrong size.
    const heads = dia ? pick("spannkopf", { size, series, clampDiaMm: dia, limit: 2 }) : [];
    withProducts(
      {
        category: "Spannköpfe",
        suggestion: dia
          ? `Spannköpfe für Spann-Ø ${dia} mm — je ein Kopf für Roh- und Fertigmaß`
          : "Passende Spannköpfe (SE sechseckig / RD rund) für Roh- und Fertigmaß",
        reason: "Pro Spanndurchmesser ein Kopf — Wechsel in Sekunden, Rundlauf bleibt",
      },
      heads
    );
  }

  if (fam === "futter") {
    // No SKUs here: the right centroteX adapter follows the machine spindle
    // (KK5/KK6/KK8 …), which the advisor does not know reliably.
    out.push({
      category: "Wechselsystem",
      suggestion: "centroteX S/M Schnellwechsel-Schnittstelle passend zu Ihrer Spindelaufnahme",
      reason: big
        ? "Bei Serienfertigung: Spannmittelwechsel in Minuten statt Stunden — auftragsorientiert fertigen"
        : "Lohnt ab regelmäßigem Spannmittelwechsel zwischen Aufträgen",
    });
    withProducts(
      {
        category: "Anschlagsystem",
        suggestion: "Anschlagsystem vario für wiederholgenaue Werkstücklage",
        reason: "Längenanschlag im Futter — gleiche Z-Lage bei jedem Teil, ohne Antasten",
      },
      pick("anschlag", { size, limit: 2 })
    );
    out.push({
      category: "Messtechnik",
      suggestion: "TESTit Spannkraftmessung — Modul passend zu Spannbereich und Spannart",
      reason: "Dokumentierte Spannkraft = Prozesssicherheit (und Pflicht nach VDI 3106 bei kritischen Teilen)",
    });
  }

  if (fam === "dorn") {
    out.push({
      category: "Adaption",
      suggestion: "MANDO Adapt für den Einsatz im vorhandenen Backenfutter",
      reason: "Innenspannung ohne Maschinenumbau — Dorn-im-Futter in Minuten gerüstet",
    });
    withProducts(
      {
        category: "Segmentspannbüchsen",
        suggestion: dia
          ? `Segmentspannbüchsen für Spann-Ø ${dia} mm — Zweitgarnitur als Verschleißreserve`
          : "Segmentspannbüchsen für jeden Bohrungsdurchmesser",
        reason: "Verschleißteil — Zweitgarnitur vermeidet Stillstand",
      },
      dia ? pick("segmentspannbuechse", { series, clampDiaMm: dia, limit: 2 }) : []
    );
  }

  if (fam === "stationaer") {
    if (big)
      withProducts(
        {
          category: "Mehrfachspannung",
          suggestion: "Mehrfachspannplatten für Paketbearbeitung",
          reason: "Mehrere Teile pro Aufspannung = Werkzeugwechsel amortisieren sich über das Paket",
        },
        pick("mehrfachspannplatte", { limit: 2 })
      );
    out.push({
      category: "Nullpunkt",
      suggestion: "DockLock Nullpunktspannsystem für wiederholgenaues Umrüsten",
      reason: "Rüstzeit je Auftrag von Minuten auf Sekunden",
    });
  }

  if (fam === "handspann") {
    withProducts(
      {
        category: "Zubehör",
        suggestion: "Wechselvorrichtung + Ausricht-Set",
        reason: "Kopfwechsel ohne Kran, µm-genaues Einsetzen",
      },
      [...pick("wechselvorrichtung", { size, limit: 1 }), ...pick("ausricht", { size, limit: 1 })]
    );
  }

  if (fam === "backen") {
    withProducts(
      {
        category: "Spannbacken",
        suggestion: "Aufsatzbacken-Satz für Roh- und Fertigteilspannung",
        reason: "Backen sind Verschleiß- und Anpassteil — weiche Backen für Fertigmaß, Krallenbacken fürs Rohteil",
      },
      pick("spannbacke", { size, limit: 2 })
    );
  }

  return out.slice(0, 4);
}

/** Automation nudge: only when the batch size justifies it — honest, with the
 *  cost-compare numbers the pipeline already computes. */
export function automationNudge(batchSize: number | null, hasManualRec: boolean): string | null {
  if (!batchSize || batchSize < 100) return null;
  if (!hasManualRec) return null; // already automated — nothing to nudge
  return (
    `Bei ${batchSize} Stück lohnt der Blick auf Automatisierung: kraft-/hydraulikbetätigte ` +
    `Spannmittel sparen je Teil ~0,6 min Handling (siehe Kostenvergleich oben) und machen ` +
    `Roboterbeladung möglich. Gern rechnen wir die Amortisation für Ihre Folgeserien.`
  );
}
