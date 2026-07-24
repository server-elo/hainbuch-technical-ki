/** Build assets/products/shop_accessories.json from the shop export.
 *  The sales layer needs concrete, orderable SKUs (Spannköpfe, Segment-
 *  spannbüchsen, Wechselvorrichtungen …) instead of generic prose, but the
 *  20 MB export must not be loaded by the server at runtime. */
import fs from "node:fs";
import path from "node:path";

const DATA = path.join(process.cwd(), "data/hainbuch-website");
const products = JSON.parse(fs.readFileSync(path.join(DATA, "shop_products_full.json"), "utf8"));
const categories = JSON.parse(fs.readFileSync(path.join(DATA, "shop_categories_clean.json"), "utf8"));
const imageMap = JSON.parse(fs.readFileSync(path.join(DATA, "shop_image_map.json"), "utf8"));
const haveImage = new Set(fs.readdirSync(path.join(process.cwd(), "assets/products/shop")));

const catById = new Map(categories.map((c) => [c.pimId, c]));
const catPath = (pimId) => {
  const parts = [];
  let id = pimId;
  while (catById.has(id) && parts.length < 6) {
    parts.push(catById.get(id).name.trim());
    id = catById.get(id).parentPimId;
  }
  return parts.reverse().join(" / ");
};

// Accessory groups the advisor sells alongside a clamping device.
const GROUPS = [
  ["spannkopf", "Spannelemente / Spannköpfe"],
  ["segmentspannbuechse", "Spannelemente / Segmentspannbüchsen"],
  ["spannbacke", "Spannelemente / Spannbacken"],
  ["wechselvorrichtung", "Zubehör / Wechselvorrichtung"],
  ["anschlag", "Zubehör / Anschlagsystem vario"],
  ["mehrfachspannplatte", "Zubehör / Mehrfachspannplatten"],
  ["ausricht", "Zubehör / Ausricht-Set"],
];

const numeric = (v) => {
  if (v === undefined || v === null) return null;
  const m = /-?[\d.,]+/.exec(String(v));
  if (!m) return null;
  const n = parseFloat(m[0].replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

const out = [];
for (const p of products) {
  const paths = (p.categoryPimIds || []).map(catPath);
  const group = GROUPS.find(([, prefix]) => paths.some((x) => x.startsWith(prefix)));
  if (!group) continue;
  const attrs = {};
  for (const a of p.attributes || []) {
    if (a && a.name) attrs[a.name] = a.displayValue ?? a.value;
  }
  const image = (imageMap[p.materialNo] || []).find((f) => haveImage.has(f));
  out.push({
    group: group[0],
    materialNo: p.materialNo,
    title: p.title,
    category: paths.find((x) => x.startsWith(group[1])) ?? paths[0],
    size: attrs["Baugröße"] != null ? String(attrs["Baugröße"]) : null,
    clampDiaMm: numeric(attrs["Spann-⌀"]),
    series: attrs["Baureihe"] ?? null,
    fits: attrs["Passend für"] ?? null,
    ...(image ? { image } : {}),
  });
}

out.sort((a, b) => a.materialNo.localeCompare(b.materialNo));
const dest = path.join(process.cwd(), "assets/products/shop_accessories.json");
fs.writeFileSync(dest, JSON.stringify(out));
console.log(`${out.length} accessory SKUs → ${dest}`);
