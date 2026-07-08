import fs from "node:fs";
import path from "node:path";

// SKU-level product photos from the HAINBUCH shop (assets/products/shop/,
// served at /product-images/shop). shop_index.json maps every shop SKU with a
// photo (5 955 of 7 243) to its image file; families share photos, so the
// matcher only has to land in the right family + Baugröße.
type ShopEntry = { materialNo: string; title: string; size: string | null; image: string };

const SHOP_INDEX: ShopEntry[] = (() => {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "assets/products/shop_index.json"), "utf8")
    );
  } catch {
    console.warn("[Images] assets/products/shop_index.json missing — no shop photos");
    return [];
  }
})();

const FAMILY_RE =
  /toplus|spanntop|mando|maxxos|torok|manok|hydrok|b-?top|b-?tex|inozet|inoflex|centrotex|centrex|testit|monteq|vario|backenmodul|magnetmodul|stirnmitnehmer|morsekegel|spannkopf|spanndorn|segmentspannb|spannbacke/gi;

// A name can carry several family tokens ("Spanndorn MAXXOS") — collect them
// all so catalogue-style and shop-style names still land in the same family.
function familySet(s: string): Set<string> {
  return new Set(
    (s.match(FAMILY_RE) ?? []).map((f) => f.toLowerCase().replace("-", ""))
  );
}

function norm(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9äöüß]+/g, " ").trim().split(/\s+/).filter(Boolean);
}

// Coarse product type, so a chuck recommendation never gets a jaw photo just
// because both say "InoFlex". Order matters: "4-Backenfutter" is a Futter.
function productType(s: string): string | undefined {
  const t = s.toLowerCase();
  if (/futter/.test(t)) return "futter";
  if (/dorn/.test(t)) return "dorn";
  if (/backen?\b|backen(?!futter|modul)/.test(t)) return "backe";
  if (/spannkopf|spannköpfe/.test(t)) return "spannkopf";
  if (/büchse/.test(t)) return "büchse";
  if (/spannstock|spannstöcke/.test(t)) return "spannstock";
  return undefined;
}

/** Image URL for a recommended product name, matched against shop SKUs.
 *  Deterministic: ties resolve to the lowest materialNo. */
export function shopProductImage(productName: string): string | undefined {
  const qFam = familySet(productName);
  if (!qFam.size) return undefined;
  const q = norm(productName);
  // Single digits ("4-Backenfutter") are type prefixes, not Baugrößen.
  const qSizes = q.filter((w) => /^\d{2,3}$/.test(w));
  const qType = productType(productName);

  // Accessory SKUs ("Flansch für MANDO/MAXXOS …") share family tokens with the
  // main products — keep them out unless the recommendation is an accessory.
  const accessoryQuery = /flansch|adapter|zugrohr|spül|grundplatte|betätigung/i.test(productName);
  const candidates = SHOP_INDEX.filter((e) => {
    if (!accessoryQuery && /\bfür\b|flansch|grundplatte/i.test(e.title)) return false;
    const eType = productType(e.title);
    if (qType && eType && qType !== eType) return false;
    const f = familySet(e.title);
    for (const fam of qFam) if (f.has(fam)) return true;
    return false;
  });
  if (!candidates.length) return undefined;

  // Pin to the named Baugröße when the recommendation carries one, so
  // "TOPlus Größe 65" gets the 65 photo even if wording varies.
  let pool = candidates;
  if (qSizes.length) {
    const sized = candidates.filter(
      (e) => qSizes.some((sz) => norm(e.title).includes(sz) || e.size === sz)
    );
    if (sized.length) pool = sized;
  }

  // Overlap first; ties go to the title with the fewest unmatched tokens
  // (prefers the primary SKU "TOROK RD 100" over "Grundplatte TOROK Gr. 100"),
  // then to the lowest materialNo for stability.
  let best: ShopEntry | null = null;
  let bestScore = 0;
  let bestPrecision = 0;
  for (const e of pool) {
    const ts = norm(e.title);
    const tset = new Set(ts);
    const score = q.filter((w) => tset.has(w)).length;
    if (!score) continue;
    const precision = score / ts.length;
    if (
      score > bestScore ||
      (score === bestScore && precision > bestPrecision) ||
      (score === bestScore && precision === bestPrecision && best && e.materialNo < best.materialNo)
    ) {
      bestScore = score;
      bestPrecision = precision;
      best = e;
    }
  }
  return best ? `/product-images/shop/${best.image}` : undefined;
}
