// ISO 286 limit computation + deterministic answer verifier.
// Pure module (no I/O): required by lite-server.cjs (prompt + post-check)
// and scripts/daily_review.cjs (nightly arithmetic audit).
const IT_RANGES = [3, 6, 10, 18, 30, 50, 80, 120, 180, 250, 315, 400, 500];
const IT = {
  5:  [4, 5, 6, 8, 9, 11, 13, 15, 18, 20, 23, 25, 27],
  6:  [6, 8, 9, 11, 13, 16, 19, 22, 25, 29, 32, 36, 40],
  7:  [10, 12, 15, 18, 21, 25, 30, 35, 40, 46, 52, 57, 63],
  8:  [14, 18, 22, 27, 33, 39, 46, 54, 63, 72, 81, 89, 97],
  9:  [25, 30, 36, 43, 52, 62, 74, 87, 100, 115, 130, 140, 155],
  10: [40, 48, 58, 70, 84, 100, 120, 140, 160, 185, 210, 230, 250],
  11: [60, 75, 90, 110, 130, 160, 190, 220, 250, 290, 320, 360, 400],
};
// Fundamental deviations in µm per size step (ISO 286-1/2).
// Shafts: h/g/f/e = upper deviation es; k/m/n/p = lower deviation ei;
// js = symmetric ±IT/2. Bores: H = EI 0; P = upper deviation ES (keyways).
const FUND = {
  h: { type: "shaft", es: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  g: { type: "shaft", es: [-2, -4, -5, -6, -7, -9, -10, -12, -14, -15, -17, -18, -20] },
  f: { type: "shaft", es: [-6, -10, -13, -16, -20, -25, -30, -36, -43, -50, -56, -62, -68] },
  e: { type: "shaft", es: [-14, -20, -25, -32, -40, -50, -60, -72, -85, -100, -110, -125, -135] },
  k: { type: "shaft", ei: [0, 1, 1, 1, 2, 2, 2, 3, 3, 4, 4, 4, 5] },
  m: { type: "shaft", ei: [2, 4, 6, 7, 8, 9, 11, 13, 15, 17, 20, 21, 23] },
  n: { type: "shaft", ei: [4, 8, 10, 12, 15, 17, 20, 23, 27, 31, 34, 37, 40] },
  p: { type: "shaft", ei: [6, 12, 15, 18, 22, 26, 32, 37, 43, 50, 56, 62, 68] },
  H: { type: "bore", EI: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  P: { type: "bore", ES: [-6, -12, -15, -18, -22, -26, -32, -37, -43, -50, -56, -62, -68] },
};
function idxFor(d) {
  for (let i = 0; i < IT_RANGES.length; i++) if (d <= IT_RANGES[i]) return i;
  return -1;
}
function fmt(v) { return (v / 1000).toFixed(3).replace(".", ","); }
function fitResult(dNom, boreGrade, shaftGrade) {
  if (!boreGrade || !shaftGrade) return null;
  const i = idxFor(dNom);
  if (i < 0 || dNom <= 0 || dNom > 500) return null;
  const bDigit = boreGrade.replace(/[^0-9]/g, "");
  const bLetter = boreGrade.replace(/[0-9]/g, "");
  const sDigit = shaftGrade.replace(/[^0-9]/g, "");
  const sLetter = shaftGrade.replace(/[0-9]/g, "");
  const itB = IT[bDigit]?.[i], itS = IT[sDigit]?.[i];
  if (!itB || !itS) return null;
  // Bore side: H (EI = 0) or P (ES from table, e.g. keyways P9).
  let EI, ES;
  if (bLetter === "H") { EI = 0; ES = EI + itB; }
  else if (bLetter === "P") {
    const pES = FUND.P?.ES[i];
    if (pES === undefined) return null;
    ES = pES; EI = ES - itB;
  }
  else return null;
  // Shaft side: es-anchored (h/g/f/e), ei-anchored (k/m/n/p), symmetric (js).
  let es, ei;
  if (sLetter.toLowerCase() === "js") {
    es = Math.ceil(itS / 2); ei = es - itS;
  } else {
    const key = Object.keys(FUND).find((k) => k === sLetter && FUND[k].type === "shaft");
    const sfd = key ? FUND[key] : null;
    if (sfd?.es !== undefined && sfd.es[i] !== undefined) { es = sfd.es[i]; ei = es - itS; }
    else if (sfd?.ei !== undefined && sfd.ei[i] !== undefined) { ei = sfd.ei[i]; es = ei + itS; }
    else return null;
  }
  const Smax = ES - ei, Smin = EI - es;
  const art = Smin >= 0 ? "Spielpassung" : Smax <= 0 ? "Presspassung" : "Übergangspassung";
  const sgn = (v) => (v >= 0 ? `+${v}` : `${v}`);
  const kenn = art === "Spielpassung"
    ? `S_min=${Smin} µm / S_max=${Smax} µm`
    : `${-Smax <= 0 ? "S" : "Ü"}_Werte: Spiel max=${Smax} µm, Übermaß max=${-Smin} µm`;
  return `Ø${dNom} ${boreGrade}/${shaftGrade}: Bohrung EI=${sgn(EI)} µm, ES=${sgn(ES)} µm, D_min=${fmt(dNom * 1000 + EI)} mm, D_max=${fmt(dNom * 1000 + ES)} mm | Welle es=${sgn(es)} µm, ei=${sgn(ei)} µm, d_max=${fmt(dNom * 1000 + es)} mm, d_min=${fmt(dNom * 1000 + ei)} mm | ${art} | ${kenn}`;
}

/** Limits for a SINGLE grade (shaft: h/g/f/e/k/m/n/p/js; bore: H/P).
 *  Returns { upper, lower } deviations in µm and { maxMm, minMm }, or null
 *  for grades outside the tabulated scope (never invent values). */
function gradeLimits(dNom, grade) {
  const i = idxFor(dNom);
  if (i < 0 || !(dNom > 0) || dNom > 500 || !grade) return null;
  const digit = String(grade).replace(/[^0-9]/g, "");
  const letter = String(grade).replace(/[0-9]/g, "");
  const it = IT[digit]?.[i];
  if (!it) return null;
  const bore = letter === "H" || letter === "P";
  if (bore) {
    if (letter === "H") {
      const EI = 0, ES = it;
      return { upper: ES, lower: EI, maxMm: dNom + ES / 1000, minMm: dNom + EI / 1000 };
    }
    const ES = FUND.P?.ES[i];
    if (ES === undefined) return null;
    const EI = ES - it;
    return { upper: ES, lower: EI, maxMm: dNom + ES / 1000, minMm: dNom + EI / 1000 };
  }
  if (letter.toLowerCase() === "js") {
    const es = Math.ceil(it / 2), ei = es - it;
    return { upper: es, lower: ei, maxMm: dNom + es / 1000, minMm: dNom + ei / 1000 };
  }
  const key = Object.keys(FUND).find((k) => k === letter && FUND[k].type === "shaft");
  const sfd = key ? FUND[key] : null;
  if (sfd?.es !== undefined && sfd.es[i] !== undefined) {
    const es = sfd.es[i], ei = es - it;
    return { upper: es, lower: ei, maxMm: dNom + es / 1000, minMm: dNom + ei / 1000 };
  }
  if (sfd?.ei !== undefined && sfd.ei[i] !== undefined) {
    const ei = sfd.ei[i], es = ei + it;
    return { upper: es, lower: ei, maxMm: dNom + es / 1000, minMm: dNom + ei / 1000 };
  }
  return null;
}

const digitsOnly = (s) => String(s).replace(/[^0-9]/g, "");
function hamming(a, b) {
  if (a.length !== b.length) return 99;
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}
const sgnUm = (v) => (v >= 0 ? `+${v}` : `${v}`);

/** Deterministic post-check for fit numbers in generated answers.
 *  Finds single-grade mentions (ØNUM GRADE, no pair clearance math), recomputes
 *  limits, and repairs near-miss numbers (digit typos like 24,984 → 34,984)
 *  plus wrong deviation pairs (+0/-13 µm → +0/-16 µm).
 *  Exact correct values are always trusted and never touched.
 *  Returns { fixed, corrections: [{ fit, wrong, right }] }. The caller applies
 *  `fixed` only when corrections.length is small (else human review). */
function verifyFitNumbers(text) {
  const T = String(text || "");
  if (T.length < 200) return { fixed: T, corrections: [] };
  const GRADE1 = "(H[5-9]|P[6-9]|h[5-9]|g[5-7]|f[6-8]|e[6-8]|k[4-7]|m[5-7]|n[5-7]|p[5-7]|s[5-7]|js[5-8])";
  // Table rows split nominal and grade ("Ø 35 mm | h6"), so separators allowed.
  const fits = [];
  const re = new RegExp(`[Øø]?\\s*(\\d{1,3}(?:[.,]\\d+)?)\\s*(?:mm)?\\s*(?:[|\\-:–—]\\s*)?${GRADE1}(?!\\s*/\\s*[A-Za-z])`, "g");
  let m;
  while ((m = re.exec(T)) !== null) {
    const d = parseFloat(m[1].replace(",", "."));
    if (!(d > 0 && d <= 500)) continue;
    const lim = gradeLimits(d, m[2]);
    if (lim) fits.push({ d, grade: m[2], index: m.index, lim });
  }
  if (!fits.length) return { fixed: T, corrections: [] };

  // All mm-numbers with positions; exact correct values are trusted.
  const allNums = [];
  const numRe = /\d{1,3}[.,]\d{1,3}/g;
  let n;
  while ((n = numRe.exec(T)) !== null) allNums.push({ raw: n[0], index: n.index });
  const trusted = new Set();
  for (const f of fits) {
    for (const v of [f.lim.maxMm, f.lim.minMm]) {
      trusted.add(v.toFixed(3).replace(".", ","));
      trusted.add(v.toFixed(3));
    }
  }
  const pairOf = (f) => [f.lim.upper, f.lim.lower];
  const matchesAnyPair = (a, b) => fits.some((f) => {
    const [u, l] = pairOf(f);
    return (a === u && b === l) || (a === l && b === u);
  });

  const edits = [];
  const claimed = (idx) => edits.some((e) => e.index === idx);
  // Group mentions by text row: a typo belongs to the row that names its fit.
  // (Prevents Ø25 h5 from "stealing" Ø35's typo from the next table row.)
  const rowOf = (idx) => ({
    from: T.lastIndexOf("\n", idx) + 1,
    to: T.indexOf("\n", idx) === -1 ? T.length : T.indexOf("\n", idx),
  });
  for (const f of fits) {
    const tag = `Ø${f.d} ${f.grade}`;
    const { from, to } = rowOf(f.index);
    const rowNums = allNums.filter((c) => c.index >= from && c.index < to && !trusted.has(c.raw) && !claimed(c.index));
    // (a) GO/NO-GO numbers in the same row (closest candidate wins; a
    // candidate claimed by both max and min is ambiguous → left alone).
    const wants = [
      { v: f.lim.maxMm },
      { v: f.lim.minMm },
    ];
    const picks = [];
    for (const w of wants) {
      const right = w.v.toFixed(3).replace(".", ",");
      const rd = digitsOnly(right);
      let best = null;
      for (const c of rowNums) {
        const cd = digitsOnly(c.raw);
        if (cd.length !== rd.length) continue;
        const h = hamming(cd, rd);
        if (h >= 1 && h <= 2 && (!best || h < best.h)) best = { c, h };
      }
      if (best) picks.push({ want: w, right, found: best.c, h: best.h });
    }
    if (picks.length === 2 && picks[0].found.index === picks[1].found.index) {
      // same number matches both — keep the closer, drop the other
      picks.sort((a, b) => a.h - b.h);
      picks.length = 1;
    }
    for (const p of picks) {
      if (claimed(p.found.index)) continue;
      edits.push({ index: p.found.index, raw: p.found.raw, right: p.right, fit: tag });
    }
    // (b) deviation-pair claims near the mention ("+0 / -13 µm").
    const devRe = /([+-]?\d+)\s*\/\s*([+-]?\d+)\s*(?:µ|μ|u)?m\b/g;
    let d2;
    // fresh regex per fit (shared lastIndex would skip); scan window only
    const win = T.slice(Math.max(0, f.index - 350), f.index + 350);
    const off = Math.max(0, f.index - 350);
    devRe.lastIndex = 0;
    while ((d2 = devRe.exec(win)) !== null) {
      const gi = off + d2.index;
      if (claimed(gi)) continue;
      const a = parseInt(d2[1], 10), b = parseInt(d2[2], 10);
      const [u, l] = pairOf(f);
      if ((a === u && b === l) || (a === l && b === u)) continue; // right (any order)
      if (matchesAnyPair(a, b)) continue; // belongs to another fit in this answer
      edits.push({ index: gi, raw: d2[0], right: `${sgnUm(u)} / ${sgnUm(l)} µm`, fit: tag });
    }
  }
  // Apply back-to-front so indices stay valid.
  let fixed = T;
  const applied = [];
  for (const e of edits.slice().sort((x, y) => y.index - x.index)) {
    fixed = fixed.slice(0, e.index) + e.right + fixed.slice(e.index + e.raw.length);
    applied.unshift({ fit: e.fit, wrong: e.raw, right: e.right });
  }
  return { fixed, corrections: applied };
}

module.exports = { IT_RANGES, IT, FUND, idxFor, fmt, fitResult, gradeLimits, verifyFitNumbers };
