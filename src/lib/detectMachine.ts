/** Machine auto-detect: match user text against known presets.
 *  Dependency-free (unit-tested via esbuild + node). Returns a preset id
 *  from MachineSelector.PRESET_MACHINES, or null.
 *
 *  Conservative by design: brand-only mentions ("DMG", "Mazak", "Haas")
 *  never trigger a specific machine — the model token is required
 *  ("NLX 2500", "QuickTurn", "ST-20", "Hermle", "DMU 50").
 *  Order matters: specific > millturn > mill > lathe
 *  ("Dreh-Fräszentrum" contains "fräs" but is millturn).
 */
export interface MachineDetection {
  presetId: string;
  /** model-specific mention (vs generic category hint) */
  specific: boolean;
}

const lower = (t: string) => (t || "").toLowerCase();
const flat = (t: string) => lower(t).replace(/[^a-z0-9äöüß]/g, "");
const has = (t: string, sub: string) => flat(t).includes(sub);
// Join letter-digit splits ("QT-200" → "qt200") but keep word boundaries,
// so short codes never match inside longer tokens ("C400" vs "XC4000").
const norm = (t: string) => lower(t).replace(/([a-zäöüß])[-\s]+(\d)/g, "$1$2");
const toks = (t: string) => norm(t).split(/[^a-z0-9äöüß]+/).filter(Boolean);
const tok = (t: string, c: string) => toks(t).includes(c);

const LATHE_RE = /dreh(maschine|maschinen|bank|bänke|zentrum|zentren)|langdreh/;
const MILL_RE = /fräs(maschine|maschinen|zentrum|zentren)|bearbeitungszentrum/;
// Bare "Fräse" (the machine, not the cutter "Fräser" or verb "fräsen").
const MILL_WORD_RE = /(^|[^a-zäöüß])fräse([^a-zäöüß]|$)/;
const MILLTURN_RE = /5\s*-?\s*achs|5\s*axis|mill\s*-?\s*turn|dreh\s*-?\s*fräs|\bbaz\b/;

export function detectMachine(text: string): MachineDetection | null {
  if (!text || text.length > 4000) return null;

  // ── specific machines (model token required) ──
  if (has(text, "nlx2500")) return { presetId: "dmg-nlx2500", specific: true };
  if (has(text, "quickturn") || tok(text, "qt200") || tok(text, "qt250"))
    return { presetId: "mazak-qt200", specific: true };
  if (tok(text, "st20") || tok(text, "st30")) return { presetId: "haas-st20", specific: true };
  if (lower(text).includes("hermle") || tok(text, "c400"))
    return { presetId: "hermle-c400", specific: true };
  if (has(text, "dmu50")) return { presetId: "dmg-dmu50", specific: true };

  // ── generic category hints (map to universal presets) ──
  const l = lower(text);
  if (MILLTURN_RE.test(l)) return { presetId: "univ-millturn", specific: false };
  if (MILL_RE.test(l) || MILL_WORD_RE.test(l)) return { presetId: "univ-cnc-mill", specific: false };
  if (LATHE_RE.test(l)) return { presetId: "univ-cnc-lathe", specific: false };
  return null;
}
