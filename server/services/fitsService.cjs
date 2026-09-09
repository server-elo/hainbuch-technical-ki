// ISO 286 Fit service: precalculation and deterministic verification
const path = require("path");
const { ROOT_DIR } = require("../config.cjs");

let fitsLib = null;
try {
  fitsLib = require(path.join(ROOT_DIR, "lib", "fits.cjs"));
} catch (e) {
  console.warn("[fits] lib unavailable:", e.message);
}

const fitResult = (fitsLib && fitsLib.fitResult) || (() => null);
const verifyFitNumbers = (fitsLib && fitsLib.verifyFitNumbers) || ((t) => ({ fixed: t, corrections: [] }));

function precomputeFits(question) {
  if (!question) return "";
  const found = [];
  const GRADE = "(?:H[5-9]|P[6-9]|[hH][5-9]|[kK][4-7]|[gG][5-7]|[fF][6-8]|[eE][6-8]|[mM][5-7]|[nN][5-7]|[pP][5-7]|[sS][5-7]|[jJ][sS]?[5-8])";
  const re = new RegExp(`[Øø\\s(]([0-9]{1,3}(?:[.,][0-9]+)?)\\s*(?:mm)?\\s*(${GRADE})\\b(?:\\s*\\/\\s*(${GRADE}))?`, "g");
  let m;
  while ((m = re.exec(question)) !== null) {
    const d = parseFloat(m[1].replace(",", "."));
    if (!(d > 0 && d <= 500)) continue;
    const g1 = m[2], g2 = m[3];
    found.push([d, g1, g2]);
  }
  const lines = [];
  const seen = new Set();
  for (const [d, g1, g2] of found) {
    const pairs = [];
    const isBore = /^[HP]/.test(g1);
    const bg = isBore ? g1.toUpperCase() : null;
    const sg = !isBore ? g1 : g2 || null;
    if (isBore) {
      for (const s of [sg || "h6", "k6", "g6", "f7"]) pairs.push([d, bg, s]);
    } else {
      for (const b of ["H7"]) pairs.push([d, b, sg]);
    }
    for (const [dd, b, s] of pairs) {
      if (!s) continue;
      const key = `${dd}-${b}-${s}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const r = fitResult(dd, b, s);
      if (r) lines.push("- " + r);
      else lines.push(`- Ø${dd} ${b}/${s}: NICHT tabelliert vorberechnet — Grenzmaße aus ISO-286-Tabelle übernehmen, NICHT schätzen.`);
    }
  }
  return lines.length
    ? `\n\nVORBEBERECHNETE PASSUNGEN (exakt per Code nach ISO 286 gerechnet – ÜBERNIMM diese Werte 1:1, rechne Passungen NICHT selbst):\n${lines.join("\n")}`
    : "";
}

module.exports = {
  fitResult,
  verifyFitNumbers,
  precomputeFits,
};
