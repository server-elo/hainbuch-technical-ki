import fs from "fs";
import path from "path";

import { shopProductImage } from "./product_images";

// Product photos: catalogue hero images extracted from the German catalogue
// (assets/products/, served at /product-images). map.json links every product
// name to its series photo.
type ProductImage = { name: string; page: number; image: string };
const PRODUCT_IMAGES: ProductImage[] = (() => {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "assets/products/map.json"), "utf8")
    );
  } catch {
    console.warn("[Images] assets/products/map.json missing — no product photos");
    return [];
  }
})();

export const FAMILY_RE =
  /toplus|spanntop|mando|maxxos|torok|manok|hydrok|b-?top|b-?tex|inozet|inoflex|centrotex|centrex|testit|monteq|vario|backenmodul|magnetmodul|stirnmitnehmer|morsekegel|spannkopf|spanndorn/i;

// Recommendations are workholding only — allowlist of families that exist in
// the 2026 catalogue. CAPTEX/KIPPTOP removed (not in this catalogue);
// centroteX/TESTIT/CENTREX added.
export const HAINBUCH_RE =
  /toplus|spanntop|mando|maxxos|torok|manok|hydrok|b-top|b-?tex|inozet|inoflex|centrotex|centrex|testit|vario|backenmodul|magnetmodul|stirnmitnehmer|morsekegel|spannkopf|spanndorn|monteq/i;

// Full product records (incl. catalogue holding force) for the clamping check.
type ProductRecord = { name: string; fields?: Record<string, string> };
const PRODUCT_RECORDS: ProductRecord[] = (() => {
  for (const p of [
    "/Users/lorenc/Desktop/Engineering-RAG/data/processed/hainbuch/products_de.json",
    path.join(process.cwd(), "assets/products/products_de.json"),
  ]) {
    try {
      return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch { /* try next */ }
  }
  console.warn("[Products] products_de.json missing — no clamping check");
  return [];
})();

/** Catalogue radial holding force in kN for a recommended product name.
 *  Conservative: among equally good matches, the WEAKEST size wins. */
export function productForceKn(productName: string): number | null {
  const family = (s: string) => s.match(FAMILY_RE)?.[0].toLowerCase().replace("-", "");
  const norm = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9äöüß]+/g, " ").trim().split(/\s+/).filter(Boolean);
  const fam = family(productName);
  if (!fam) return null;
  const q = norm(productName);
  // If the recommendation names a Baugröße (e.g. "Größe 100"), pin the lookup
  // to entries carrying that size — keeps the kN value stable even when the
  // LLM words the product name slightly differently between turns.
  const qSizes = q.filter((w) => /^\d{1,3}$/.test(w));
  const candidates = PRODUCT_RECORDS.filter((p) => {
    if (family(p.name) !== fam) return false;
    const raw = p.fields?.spannkraft_radial_kn;
    return !!raw && Number.isFinite(parseFloat(String(raw).replace(",", ".")));
  });
  let pool = candidates;
  if (qSizes.length) {
    const sized = candidates.filter((p) => qSizes.some((sz) => norm(p.name).includes(sz)));
    if (sized.length) pool = sized;
  }
  let bestScore = -1;
  let bestForces: number[] = [];
  for (const p of pool) {
    const force = parseFloat(String(p.fields!.spannkraft_radial_kn).replace(",", "."));
    if (force <= 0) continue;
    const ts = new Set(norm(p.name));
    const score = q.filter((w) => ts.has(w)).length;
    if (score > bestScore) {
      bestScore = score;
      bestForces = [force];
    } else if (score === bestScore) {
      bestForces.push(force);
    }
  }
  return bestForces.length ? Math.min(...bestForces) : null;
}

export function productImageUrl(productName: string): string | undefined {
  // SKU-level shop photo first (covers nearly every product incl. Baugröße),
  // catalogue hero image as fallback.
  const shopImage = shopProductImage(productName);
  if (shopImage) return shopImage;
  const family = (s: string) => s.match(FAMILY_RE)?.[0].toLowerCase().replace("-", "");
  const norm = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9äöüß]+/g, " ").trim().split(/\s+/).filter(Boolean);
  const fam = family(productName);
  if (!fam) return undefined;
  const q = norm(productName);
  let best: { score: number; image: string } | null = null;
  for (const p of PRODUCT_IMAGES) {
    if (family(p.name) !== fam) continue;
    const ts = new Set(norm(p.name));
    const score = q.filter((w) => ts.has(w)).length;
    if (!best || score > best.score) best = { score, image: p.image };
  }
  return best ? `/product-images/${best.image}` : undefined;
}

// Users never want catalogue page references in answers — strip them
// deterministically, whatever the LLM produces.
const PAGE_REF_PAREN_RE =
  /\s*\([^()]*\b(?:S\.|Seiten?|Katalogseite[n]?|page[s]?|p\.|pág(?:ina)?s?\.?|pagina|sayfa)\s*\d+[^()]*\)/gi;
const PAGE_REF_INLINE_RE =
  /(?:,\s*)?(?:siehe\s+|vgl\.\s*)?(?:Katalog(?:auszug)?[,\s-]*)?\b(?:Katalogseite[n]?|Seiten?|S\.|pages?|p\.|páginas?|pagine|sayfa)\s*\d+(?:\s*(?:[-–,]|und|bis|to|a)\s*\d+)*/gi;

export function stripPageRefs(text: string): string {
  return text
    .replace(PAGE_REF_PAREN_RE, "")
    .replace(PAGE_REF_INLINE_RE, "")
    .replace(/\b(?:siehe|see|vgl\.?|voir|vedi|bkz\.?)\s*([.,;:!?])/gi, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ ([,.;:])/g, "$1")
    .replace(/\(\s*\)/g, "")
    .trim();
}
