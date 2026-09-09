// Gold Standards and verified reference retrieval
const fs = require("fs");
const path = require("path");
const { ROOT_DIR, BASE_URL } = require("../config.cjs");
const { CATALOG } = require("./catalogService.cjs");

const DATA_DIR = path.join(ROOT_DIR, "data");
const GOLD_FILE = path.join(DATA_DIR, "gold_standards.json");

function retrieveGoldStandards(query) {
  try {
    if (!fs.existsSync(GOLD_FILE)) return "";
    const list = JSON.parse(fs.readFileSync(GOLD_FILE, "utf8"));
    if (!list.length) return "";
    const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 3);
    const hit = list.find(item => terms.some(t => item.question.toLowerCase().includes(t)));
    if (!hit) return "";
    const snippet = hit.answer.slice(0, 1500)
      .replace(/http:\/\/localhost:\d+/g, BASE_URL)
      .replace(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g, BASE_URL);
    return `\n\nOFFIZIELL VERIFIZIERTE REFERENZ-AUSLEGUNG (als Vorbild für Struktur, Bild-URLs und Arbeitsplan nutzen):\nFrage: ${hit.question}\nAntwort-Muster:\n${snippet}...\n`;
  } catch (e) {
    return "";
  }
}

function catalogText(p) {
  const f = p.fields || {};
  return Object.entries(f)
    .map(([k, v]) => `${k}: ${v}`)
    .join(" | ");
}

function retrieveCatalog(query, top = 20) {
  const terms = query
    .toLowerCase()
    .replace(/[^\wäöüß\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
  if (!terms.length) return [];
  const scored = CATALOG.map((p) => {
    const hay = `${p.name} ${catalogText(p)}`.toLowerCase();
    let score = 0;
    for (const t of terms) if (hay.includes(t)) score += t.length > 4 ? 2 : 1;
    return { p, score };
  })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, top);
  return scored.map((s) => s.p);
}

module.exports = {
  retrieveGoldStandards,
  retrieveCatalog,
};
