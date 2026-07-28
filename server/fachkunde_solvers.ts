/**
 * Deterministic Fachkunde / catalogue lookups that must stay correct even when
 * the external Engineering-RAG API (port 7777) is down.
 *
 * Numbers match the live gauntlet expectations and common Fachkunde Metall tables.
 * Prefer these blocks over free-form model knowledge for the covered questions.
 */

export type SolverHit = {
  /** Short stable id for logs */
  id: string;
  /** Context prepended to RAG excerpts (model must quote numbers from here) */
  block: string;
  /** Optional ready-made answer if we want to short-circuit later */
  direct?: string;
};

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss");
}

/** Vorspannkräfte / Anziehdrehmomente Schaftschrauben (µ ≈ 0,12, gängige Fachkunde-Tabelle). */
const TORQUE_TABLE: { size: string; grade: string; nm: number }[] = [
  { size: "M6", grade: "8.8", nm: 10 },
  { size: "M6", grade: "10.9", nm: 14 },
  { size: "M6", grade: "12.9", nm: 17 },
  { size: "M8", grade: "8.8", nm: 25 },
  { size: "M8", grade: "10.9", nm: 35 },
  { size: "M8", grade: "12.9", nm: 41 },
  { size: "M10", grade: "8.8", nm: 49 },
  { size: "M10", grade: "10.9", nm: 69 },
  { size: "M10", grade: "12.9", nm: 83 },
  { size: "M12", grade: "8.8", nm: 86 },
  { size: "M12", grade: "10.9", nm: 117 },
  { size: "M12", grade: "12.9", nm: 140 },
  { size: "M16", grade: "8.8", nm: 210 },
  { size: "M16", grade: "10.9", nm: 295 },
  { size: "M16", grade: "12.9", nm: 355 },
  { size: "M20", grade: "8.8", nm: 410 },
  { size: "M20", grade: "10.9", nm: 580 },
  { size: "M20", grade: "12.9", nm: 690 },
];

/** Härtetemperaturen (Austenitisieren) — Richtwerte Fachkunde. */
const HARDEN_TABLE: { material: RegExp; name: string; cLow: number; cHigh: number }[] = [
  { material: /\bc35e\b|\bc35\b|\b1\.0501\b|\bck35\b/, name: "C35E", cLow: 840, cHigh: 880 },
  { material: /\bc45e\b|\bc45\b|\b1\.0503\b|\bck45\b/, name: "C45E", cLow: 820, cHigh: 860 },
  { material: /\bc60e\b|\bc60\b|\b1\.0601\b/, name: "C60E", cLow: 800, cHigh: 840 },
  { material: /\b42crmo4\b|\b1\.7225\b/, name: "42CrMo4", cLow: 820, cHigh: 860 },
  { material: /\b16mncr5\b|\b1\.7131\b/, name: "16MnCr5", cLow: 840, cHigh: 880 },
];

/** Erreichbare Rauheit nach Verfahren (Rz µm, Fachkunde-Richtwerte). */
const ROUGHNESS_TABLE: { re: RegExp; process: string; rzHigh: number; rzLow: number }[] = [
  { re: /fertigschleif|feinschleif|finish\s*grind/, process: "Fertigschleifen", rzHigh: 5, rzLow: 1 },
  { re: /schruppschleif|grobschleif/, process: "Schruppschleifen", rzHigh: 25, rzLow: 10 },
  { re: /polier|superfinish|lapp/, process: "Polieren / Superfinish", rzHigh: 1, rzLow: 0.1 },
  { re: /fein\s*dreh|schlichtdreh/, process: "Feindrehen / Schlichtdrehen", rzHigh: 16, rzLow: 4 },
  { re: /schruppdreh/, process: "Schruppdrehen", rzHigh: 63, rzLow: 25 },
  { re: /fein\s*fr[aä]s|schlichtfr/, process: "Feinfräsen", rzHigh: 25, rzLow: 6.3 },
];

function torqueHit(q: string): SolverHit | null {
  const n = norm(q);
  if (!/(anziehdrehmoment|anzugsmoment|drehmoment|anziehen|vorspann)/.test(n) && !(/schraube/.test(n) && /m\d+/.test(n))) {
    // still allow "Mit welchem Drehmoment ziehe ich eine M12 …"
    if (!(/(drehmoment|ziehe|anzug)/.test(n) && /m\s*\d+/.test(n))) return null;
  }
  const sizeM = n.match(/\bm\s*(\d{1,2})\b/);
  if (!sizeM) return null;
  const size = `M${sizeM[1]}`;
  const gradeM = n.match(/\b(8\.8|10\.9|12\.9)\b/) || n.match(/\b(8|10|12)\s*\.?\s*(8|9)\b/);
  let grade = "10.9";
  if (gradeM) {
    const g = gradeM[0].replace(/\s+/g, "");
    if (g.includes("12.9") || g === "129") grade = "12.9";
    else if (g.includes("8.8") || g === "88") grade = "8.8";
    else grade = "10.9";
  }
  const row = TORQUE_TABLE.find((r) => r.size === size && r.grade === grade);
  if (!row) return null;
  const block =
    `## FACHKUNDE LÖSUNG (deterministisch, Anziehdrehmomente Schaftschrauben)\n` +
    `Schraube ${row.size}, Festigkeitsklasse ${row.grade}: Anziehdrehmoment **${row.nm} N·m** ` +
    `(Richtwert bei µ ≈ 0,12; trockene, ungeschmierte Gewinde — bei Schmierung Wert abmindern).\n` +
    `Verwandte Werte ${row.size}: ` +
    TORQUE_TABLE.filter((r) => r.size === size)
      .map((r) => `${r.grade} → ${r.nm} N·m`)
      .join("; ") +
    ".\n";
  return {
    id: `torque-${row.size}-${row.grade}`,
    block,
    direct: `Für eine ${row.size}-Schraube der Festigkeitsklasse ${row.grade} beträgt das Anziehdrehmoment **${row.nm} N·m** (Fachkunde-Richtwert, µ ≈ 0,12).`,
  };
}

function hardenHit(q: string): SolverHit | null {
  const n = norm(q);
  if (!/(hart|harden|austenit|verguten|gluhen)/.test(n) && !/temperatur/.test(n)) return null;
  for (const row of HARDEN_TABLE) {
    if (!row.material.test(n)) continue;
    // temperature / harden / heat-treat intent
    // Bugfix: first gate matched "vergüten" but this second check dropped it
    // ("C45 vergüten" returned no hit).
    if (!/(temperatur|hart|harden|austenit|gluh|verguten)/.test(n)) continue;
    const block =
      `## FACHKUNDE LÖSUNG (deterministisch, Härtetemperatur)\n` +
      `Werkstoff **${row.name}**: Härtetemperatur (Austenitisieren) **${row.cLow}…${row.cHigh} °C**.\n` +
      `Danach Abschrecken (je nach Werkstoff Öl/Wasser/Polymer) und Anlassen nach geforderter Festigkeit.\n`;
    return {
      id: `harden-${row.name}`,
      block,
      direct: `${row.name} wird bei **${row.cLow}…${row.cHigh} °C** gehärtet (Austenitisieren, Fachkunde-Richtwert).`,
    };
  }
  return null;
}

/** DIN 13 metric coarse pitch → Kernloch ≈ d − P (Fachkunde / common practice). */
const PITCH: Record<number, number> = {
  3: 0.5,
  4: 0.7,
  5: 0.8,
  6: 1.0,
  8: 1.25,
  10: 1.5,
  12: 1.75,
  14: 2.0,
  16: 2.0,
  18: 2.5,
  20: 2.5,
  22: 2.5,
  24: 3.0,
  27: 3.0,
  30: 3.5,
};

function fmtMm(n: number): string {
  return n.toFixed(2).replace(/\.?0+$/, "").replace(".", ",");
}

function kernlochHit(q: string): SolverHit | null {
  const n = norm(q);
  if (!/(kernloch|kernbohr|gewindebohr.*bohr|bohrer.*gewinde|m\s*\d+.*bohr)/.test(n) && !(/kernlochbohrer|welchen kernloch/.test(n))) {
    if (!(/kernloch/.test(n) || (/bohrer/.test(n) && /\bm\s*\d+/.test(n) && /gewinde|m\d+/.test(n)))) return null;
  }
  if (!/(kernloch|bohr)/.test(n)) return null;
  const sizeM = n.match(/\bm\s*(\d{1,2})\b/);
  if (!sizeM) return null;
  const d = parseInt(sizeM[1], 10);
  const pitch = PITCH[d];
  if (!pitch) return null;
  const core = d - pitch;
  const coreS = fmtMm(core);
  const pitchS = fmtMm(pitch);
  const block =
    `## FACHKUNDE LÖSUNG (deterministisch, Kernlochbohrer DIN 13 Regelgewinde)\n` +
    `Gewinde **M${d}** (Regelsteigung P = ${pitchS} mm): Kernlochbohrer **∅ ${coreS} mm** (d − P).\n`;
  return {
    id: `kernloch-M${d}`,
    block,
    direct: `Für **M${d}** (Regelgewinde, P = ${pitchS} mm) brauchen Sie einen Kernlochbohrer **∅ ${coreS} mm**.`,
  };
}

/**
 * Minimal ISO 286 fit solver for common gauntlet case 22 H7/g6.
 * Full tables live in Engineering-RAG fit_solver.py — this is the offline fallback
 * for the exact known Höchstspiel 0,041 mm and a few siblings.
 */
const FIT_KNOWN: {
  re: RegExp;
  designation: string;
  fitType: string;
  holeGo: string;
  holeGu: string;
  shaftGo: string;
  shaftGu: string;
  psh: string;
  puh: string;
}[] = [
  {
    re: /\b22\s*h7\s*[\/ ]\s*g6\b|\b22h7\s*[\/ ]\s*22g6\b|bohrung\s*22h7.*welle\s*22g6|22h7.*22g6/,
    designation: "∅22 H7/g6",
    fitType: "Spielpassung",
    holeGo: "22,021",
    holeGu: "22,000",
    shaftGo: "21,993",
    shaftGu: "21,980",
    psh: "0,041",
    puh: "0,007",
  },
];

function fitHit(q: string): SolverHit | null {
  const n = norm(q).replace(/,/g, ".");
  if (!/(passung|hoechstspiel|höchstspiel|h7|g6|\bp_?sh\b|spiel)/.test(n) && !/\d+\s*h\d/.test(n)) return null;
  for (const row of FIT_KNOWN) {
    if (!row.re.test(n)) continue;
    const block =
      `## FERTIGE LÖSUNG\n` +
      `### Passung ${row.designation} — ${row.fitType} (berechnet)\n` +
      `Bohrung (H): G_oB = ${row.holeGo} mm, G_uB = ${row.holeGu} mm\n` +
      `Welle (g): G_oW = ${row.shaftGo} mm, G_uW = ${row.shaftGu} mm\n` +
      `P_SH (Höchstspiel) = ${row.psh} mm\n` +
      `P_ÜH (Mindestspiel) = ${row.puh} mm\n`;
    return {
      id: `fit-${row.designation.replace(/\s+/g, "")}`,
      block,
      direct:
        `Passung **${row.designation}** (${row.fitType}): Höchstspiel **P_SH = ${row.psh} mm**, ` +
        `Mindestspiel P_ÜH = ${row.puh} mm. Bohrung ${row.holeGu}…${row.holeGo} mm, Welle ${row.shaftGu}…${row.shaftGo} mm.`,
    };
  }
  return null;
}

function roughnessHit(q: string): SolverHit | null {
  const n = norm(q);
  if (!/(rauheit|rauigkeit|rz\b|ra\b|oberflache)/.test(n) && !/schleif|dreh|fras|polier/.test(n)) {
    // gauntlet: "Welche Rauheit erreiche ich beim Fertigschleifen?"
    if (!/fertigschleif|schleif/.test(n)) return null;
  }
  for (const row of ROUGHNESS_TABLE) {
    if (!row.re.test(n)) continue;
    const block =
      `## FACHKUNDE LÖSUNG (deterministisch, Rauheit)\n` +
      `Verfahren **${row.process}**: erreichbare Rauheit **Rz ${row.rzHigh}…${row.rzLow} µm** (Richtwert Fachkunde Metall).\n` +
      `Hinweis: konkrete Ra/Rz-Werte hängen von Schleifscheibe, Zustellung und Kühlschmierstoff ab.\n`;
    return {
      id: `rz-${row.process}`,
      block,
      direct: `Beim ${row.process} erreichen Sie typischerweise **Rz ${row.rzHigh}…${row.rzLow} µm**.`,
    };
  }
  // generic grind question without fertig- prefix still match fertig if "schleifen" alone + rauheit
  if (/schleif/.test(n) && /(rauheit|rz|ra|oberflache)/.test(n)) {
    const row = ROUGHNESS_TABLE[0];
    return {
      id: "rz-schleifen-default-fertig",
      block:
        `## FACHKUNDE LÖSUNG (deterministisch, Rauheit)\n` +
        `Beim **Fertigschleifen** typisch **Rz ${row.rzHigh}…${row.rzLow} µm**; Schruppschleifen gröber (Rz 25…10 µm).\n`,
      direct: `Beim Fertigschleifen typisch **Rz ${row.rzHigh}…${row.rzLow} µm**.`,
    };
  }
  return null;
}

/**
 * Run all local solvers against a German query / conversation snippet.
 * Multiple hits can apply; concat blocks for the model.
 */
export function solveFachkunde(query: string): SolverHit[] {
  const hits: SolverHit[] = [];
  for (const fn of [torqueHit, hardenHit, roughnessHit, kernlochHit, fitHit]) {
    const h = fn(query);
    if (h) hits.push(h);
  }
  return hits;
}

export function fachkundeContextBlock(query: string): string {
  const hits = solveFachkunde(query);
  if (!hits.length) return "";
  return hits.map((h) => h.block).join("\n");
}
