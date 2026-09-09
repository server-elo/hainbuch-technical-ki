// Catalog and knowledge base indexing and retrieval service
const fs = require("fs");
const {
  KB_PATH,
  IMG_PATH,
  SHOP_JSON,
  CATALOG_JSON,
  MAP_JSON,
} = require("../config.cjs");

let IMAGES = {};
try {
  IMAGES = JSON.parse(fs.readFileSync(IMG_PATH, "utf8"));
  console.log(`Bildindex geladen: ${Object.keys(IMAGES).length} Produktseiten`);
} catch (e) {
  console.warn("Bildindex nicht geladen:", e.message);
}

let KB = [];
try {
  const raw = JSON.parse(fs.readFileSync(KB_PATH, "utf8"));
  KB = raw
    .filter((p) => p && (p.name || p.meta_description))
    .map((p) => ({
      name: p.name || p.meta_title || "",
      url: p.url || "",
      desc: p.meta_description || "",
      text: [p.name, p.meta_title, p.meta_description, ...(p.features || [])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase(),
    }));
  console.log(`Wissensbasis geladen: ${KB.length} HAINBUCH-Einträge`);
} catch (e) {
  console.warn("Wissensbasis nicht geladen:", e.message);
}

const STOP = new Set(
  "ist im in der den dem das und oder für mit auf von zu ein eine einer eines wie was wer wo wann warum welche welcher welches kann man mich mir meine der die es gibt auch nicht nur bei zum zur aus beim sind sein habe ich möchte brauche brauchen gerne bitte wäre wären hat haben wird werden kann könnte sollte muss denn dann sehr mehr als auch the a an of to for with on in is are how what why which do does i my me we you your".split(
    " "
  )
);

function retrieveKb(query, top = 8) {
  const terms = query
    .toLowerCase()
    .replace(/[^\wäöüß\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
  if (!terms.length) return [];
  const scored = KB.map((entry) => {
    let score = 0;
    for (const t of terms) if (entry.text.includes(t)) score += 1;
    return { entry, score };
  })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, top);
  return scored.map((s) => s.entry);
}

function buildKbContext(question) {
  const hits = retrieveKb(question);
  if (!hits.length) return "";
  const lines = hits.map(
    (h) => `- ${h.name}${h.desc ? ": " + h.desc : ""} (Quelle: ${h.url})`
  );
  return `\n\nAKTUELLE HAINBUCH-INFORMATIONEN (aus der HAINBUCH-Datenbank, für diese Anfrage ausgewählt – Foto-URLs dürfen direkt eingebunden werden):\n${lines.join(
    "\n"
  )}`;
}

let SHOP = [];
try {
  const all = JSON.parse(fs.readFileSync(SHOP_JSON, "utf8"));
  SHOP = all
    .filter((p) => p.title)
    .map((p) => ({
      materialNo: p.materialNo || "",
      title: p.title,
      category: p.category || "",
      size: p.size || "",
      clampDiaMm: p.clampDiaMm || "",
      fits: p.fits || "",
      group: p.group || "",
      image: p.image || "",
      text: `${p.materialNo || ""} ${p.title} ${p.category || ""} ${p.size || ""} ${p.clampDiaMm ? "ø" + p.clampDiaMm + " " + p.clampDiaMm + "mm" : ""} ${p.fits || ""} ${p.group || ""}`.toLowerCase(),
    }));
  console.log(`Shop-Produkte geladen: ${SHOP.length} (mit Foto & Details)`);
} catch (e) {
  console.warn("Shop-Daten nicht geladen:", e.message);
}

const shopCache = new Map();
function retrieveShop(query, top = 20) {
  const terms = query
    .toLowerCase()
    .replace(/[^\wäöüß\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t))
    .slice(0, 12);
  if (!terms.length) return [];
  const cacheKey = terms.slice().sort().join("|") + "#" + top;
  const cached = shopCache.get(cacheKey);
  if (cached) return cached;
  const scored = SHOP.map((p) => {
    let score = 0;
    for (const t of terms) {
      if (p.text.includes(t)) {
        score += (t === p.materialNo?.toLowerCase() || t === String(p.clampDiaMm) || t === `ø${p.clampDiaMm}`) ? 5 : 1;
      }
    }
    return { p, score };
  })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);
  const out = [];
  const perGroup = new Map();
  for (const s of scored) {
    const g = s.p.group || "sonstige";
    const n = perGroup.get(g) || 0;
    if (n >= 5) continue;
    perGroup.set(g, n + 1);
    out.push(s.p);
    if (out.length >= top) break;
  }
  shopCache.set(cacheKey, out);
  if (shopCache.size > 200) {
    const first = shopCache.keys().next().value;
    shopCache.delete(first);
  }
  return out;
}

let CATALOG = [];
let HERO = {};
try {
  const catRaw = JSON.parse(fs.readFileSync(CATALOG_JSON, "utf8"));
  CATALOG = Array.isArray(catRaw) ? catRaw : [];
  console.log(`Katalog geladen: ${CATALOG.length} Produkte`);
} catch (e) {
  console.warn("Katalog nicht geladen:", e.message);
}
try {
  const mapRaw = JSON.parse(fs.readFileSync(MAP_JSON, "utf8"));
  if (Array.isArray(mapRaw)) {
    for (const m of mapRaw) {
      if (m && m.name && m.image) HERO[m.name] = m.image;
    }
  }
  console.log(`Hero-Map geladen: ${Object.keys(HERO).length} Einträge`);
} catch (e) {
  console.warn("Hero-Map nicht geladen:", e.message);
}

const CANONICAL_HERO = {
  "inoflex vf": "hero_262.jpg",
  "inoflex vd": "hero_136.jpg",
  "inoflex vt-s": "hero_136.jpg",
  "inoflex": "hero_136.jpg",
  "inozet": "hero_136.jpg",
  "b-top3": "hero_150.jpg",
  "b-top": "hero_146.jpg",
  "manok plus": "hero_246.jpg",
  "manok": "hero_242.jpg",
  "hydrok": "hero_254.jpg",
  "torok": "hero_124.jpg",
  "mando t211": "hero_178.jpg",
  "mando t212": "hero_178.jpg",
  "mando g211": "hero_212.jpg",
  "mando adapt": "hero_272.jpg",
  "maxxos t211": "hero_216.jpg",
  "maxxos t212": "hero_216.jpg",
  "maxxos": "hero_216.jpg",
  "spanntop nova": "hero_94.jpg",
  "spanntop nova kombi axzug": "hero_94.jpg",
  "spanntop nova kombi axfix": "hero_94.jpg",
  "spanntop mini": "hero_74.jpg",
  "spanntop mini axzug": "hero_74.jpg",
  "spanntop mini axfix": "hero_74.jpg",
  "toplus mini": "hero_28.jpg",
  "toplus premium": "hero_48.jpg",
  "toplus kombi": "hero_60.jpg",
  "toplus nova": "hero_60.jpg",
  "toplus": "hero_60.jpg",
  "centrotex s": "hero_242.jpg",
  "centrotex m": "hero_242.jpg",
  "centrotex": "hero_242.jpg",
  "monteq": "hero_372.jpg",
  "testit": "hero_338.jpg",
  "test module": "hero_338.jpg",
};

function getHeroForProduct(name) {
  const lower = (name || "").toLowerCase().trim();
  const keys = Object.keys(CANONICAL_HERO).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (lower.includes(k)) return CANONICAL_HERO[k];
  }
  if (HERO[name] && HERO[name] !== "hero_458.jpg") return HERO[name];
  return HERO[name] || null;
}

function getCounts() {
  return {
    kb: KB.length,
    catalog: CATALOG.length,
    shop: SHOP.length,
    images: Object.keys(IMAGES).length,
    heroMap: Object.keys(HERO).length,
  };
}

module.exports = {
  IMAGES,
  KB,
  CATALOG,
  SHOP,
  HERO,
  retrieveKb,
  buildKbContext,
  retrieveShop,
  getHeroForProduct,
  getCounts,
};
