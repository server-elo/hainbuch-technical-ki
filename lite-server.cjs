const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3002;
const LLM_URL = process.env.LLM_URL || "http://127.0.0.1:8317/v1/chat/completions";
const MODEL_ID = process.env.MODEL_ID || "gemini-3.7-flash-high";
const APP_KEY = process.env.APP_KEY || "";
const KB_PATH =
  process.env.KB_PATH ||
  "/Users/lorenc/projects/hainbuch-technical-advisor/data/hainbuch-website/hainbuch_products.json";
const IMG_PATH = process.env.IMG_PATH || path.join(__dirname, "hainbuch-images.json");
const SHOP_DIR = process.env.SHOP_DIR || path.join(__dirname, "catalog", "shop");
const SHOP_JSON = process.env.SHOP_JSON || path.join(__dirname, "catalog", "shop_accessories.json");
const CATALOG_JSON = process.env.CATALOG_JSON || path.join(__dirname, "catalog", "products_de.json");
const MAP_JSON = process.env.MAP_JSON || path.join(__dirname, "catalog", "map.json");
const HERO_DIR = path.join(__dirname, "catalog");
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const ADMIN_KEY = process.env.ADMIN_KEY || "";
const TRUST_LOOPBACK = process.env.TRUST_LOOPBACK !== "0";
const RATE_PER_HOUR = Number(process.env.RATE_MAX_PER_HOUR || 120);
const RATE_PER_DAY = Number(process.env.RATE_MAX_PER_DAY || 800);

// Cost protection: per-IP sliding hour window + global daily budget.
// Loopback ist optional ausgenommen (TRUST_LOOPBACK). Cloudflared liefert
// jeden öffentlichen Request über Loopback → alle teilen sich einen Bucket
// (= globales Limit), forging von CF-Headern wird nie als Bucket-Key genutzt.
const rateBuckets = new Map();
let dayBudget = { day: "", used: 0 };
setInterval(() => {
  const now = Date.now();
  for (const [ip, hits] of rateBuckets) {
    const fresh = hits.filter((t) => now - t < 3_600_000);
    if (fresh.length === 0) rateBuckets.delete(ip);
    else rateBuckets.set(ip, fresh);
  }
}, 10 * 60 * 1000).unref?.();

function isLoopback(req) {
  const raw = (req.socket && req.socket.remoteAddress) || "";
  return (
    raw === "127.0.0.1" ||
    raw === "::1" ||
    raw === "::ffff:127.0.0.1" ||
    raw.endsWith("/127.0.0.1")
  );
}

function rateLimited(req, res) {
  if (TRUST_LOOPBACK && isLoopback(req)) return false;
  const ip = (req.socket && req.socket.remoteAddress) || "unknown";
  const now = Date.now();
  const hits = (rateBuckets.get(ip) || []).filter((t) => now - t < 3_600_000);
  const deny = (msg) => {
    res.writeHead(429, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: msg }));
    return true;
  };
  if (hits.length >= RATE_PER_HOUR)
    return deny("Zu viele Anfragen — bitte in einer Stunde erneut versuchen.");
  const today = new Date().toISOString().slice(0, 10);
  if (dayBudget.day !== today) dayBudget = { day: today, used: 0 };
  if (dayBudget.used >= RATE_PER_DAY)
    return deny("Tagesbudget erreicht — bitte morgen erneut versuchen.");
  hits.push(now);
  rateBuckets.set(ip, hits);
  dayBudget.used++;
  return false;
}

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

function retrieve(query, top = 8) {
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

function buildContext(question) {
  const hits = retrieve(question);
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
    .filter((p) => p.image && p.title)
    .map((p) => ({
      title: p.title,
      category: p.category || "",
      image: p.image,
      text: `${p.title} ${p.category}`.toLowerCase(),
    }));
  console.log(`Shop-Produkte geladen: ${SHOP.length} (mit Foto)`);
} catch (e) {
  console.warn("Shop-Daten nicht geladen:", e.message);
}

function retrieveShop(query, top = 18) {
  const terms = query
    .toLowerCase()
    .replace(/[^\wäöüß\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
  if (!terms.length) return [];
  const scored = SHOP.map((p) => {
    let score = 0;
    for (const t of terms) if (p.text.includes(t)) score += 1;
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
  return out;
}

let CATALOG = [];
let HERO = {};
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
  // Check exact/prefix match first
  for (const [k, img] of Object.entries(CANONICAL_HERO)) {
    if (lower.includes(k)) return img;
  }
  if (HERO[name] && HERO[name] !== "hero_458.jpg") return HERO[name];
  return HERO[name] || null;
}

// ── Persistent Chat Logging ──────────────────────────────────────────
const LOGS_DIR = path.join(__dirname, "logs");
const DAILY_LOGS_DIR = path.join(LOGS_DIR, "daily");
try {
  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
  if (!fs.existsSync(DAILY_LOGS_DIR)) fs.mkdirSync(DAILY_LOGS_DIR, { recursive: true });
} catch (e) {
  console.warn("Failed to create log dirs:", e.message);
}

function logChatInteraction(entry) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const line = JSON.stringify({ ...entry, recordedAt: new Date().toISOString() }) + "\n";
    fs.appendFileSync(path.join(LOGS_DIR, "chats.jsonl"), line, "utf8");
    fs.appendFileSync(path.join(DAILY_LOGS_DIR, `${today}.jsonl`), line, "utf8");
  } catch (err) {
    console.error("Chat logging error:", err.message);
  }
}

// ── Gold Standards & Verified QA Reference ───────────────────────────
const DATA_DIR = path.join(__dirname, "data");
const GOLD_FILE = path.join(DATA_DIR, "gold_standards.json");
function retrieveGoldStandards(query) {
  try {
    if (!fs.existsSync(GOLD_FILE)) return "";
    const list = JSON.parse(fs.readFileSync(GOLD_FILE, "utf8"));
    if (!list.length) return "";
    const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 3);
    const hit = list.find(item => terms.some(t => item.question.toLowerCase().includes(t)));
    if (!hit) return "";
    return `\n\nOFFIZIELL VERIFIZIERTE REFERENZ-AUSLEGUNG (als Vorbild für Struktur, Bild-URLs und Arbeitsplan nutzen):\nFrage: ${hit.question}\nAntwort-Muster:\n${hit.answer.slice(0, 1500)}...\n`;
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
    .filter((t) => t.length > 2 && !STOP.has(t));
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


const IT_RANGES = [3, 6, 10, 18, 30, 50, 80, 120, 180, 250, 315, 400, 500];
const IT = {
  5:  [4, 5, 6, 8, 9, 11, 13, 15, 18, 20, 23, 25, 27],
  6:  [6, 8, 9, 11, 13, 16, 19, 22, 25, 29, 32, 36, 40],
  7:  [10, 12, 15, 18, 21, 25, 30, 35, 40, 46, 52, 57, 63],
  8:  [14, 18, 22, 27, 33, 39, 46, 54, 63, 72, 81, 89, 97],
  9:  [25, 30, 36, 43, 52, 62, 74, 87, 100, 115, 130, 140, 155],
  11: [60, 75, 90, 110, 130, 160, 190, 220, 250, 290, 320, 360, 400],
};
const FUND = {
  h: { type: "shaft", es: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  g: { type: "shaft", es: [-2, -4, -5, -6, -7, -9, -10, -12, -14, -15, -17, -18, -20] },
  f: { type: "shaft", es: [-6, -10, -13, -16, -20, -25, -30, -36, -43, -50, -56, -62, -68] },
  e: { type: "shaft", es: [-14, -20, -25, -32, -40, -50, -60, -72, -85, -100, -110, -125, -135] },
  k: { type: "shaft", ei: [2, 1, 1, 1, 2, 2, 2, 3, 3, 4, 4, 4, 5] },
  H: { type: "bore", EI: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
};
function idxFor(d) {
  for (let i = 0; i < IT_RANGES.length; i++) if (d <= IT_RANGES[i]) return i;
  return -1;
}
function fmt(v) { return (v / 1000).toFixed(3).replace(".", ","); }
function fitResult(dNom, boreGrade, shaftGrade) {
  const i = idxFor(dNom);
  if (i < 0) return null;
  const bDigit = boreGrade.replace(/[^0-9]/g, "");
  const sDigit = shaftGrade.replace(/[^0-9]/g, "");
  const sLetter = shaftGrade.replace(/[0-9]/g, "");
  const itB = IT[bDigit]?.[i], itS = IT[sDigit]?.[i];
  if (!itB || !itS) return null;
  const EI = FUND.H.EI[i];
  const ES = EI + itB;
  let es, ei;
  const sf = FUND[sLetter];
  if (sf?.es) { es = sf.es[i]; ei = es - itS; }
  else if (sf?.ei) { ei = sf.ei[i]; es = ei + itS; }
  else return null;
  const Smax = ES - ei, Smin = EI - es;
  const art = Smin >= 0 ? "Spielpassung" : Smax <= 0 ? "Presspassung" : "Übergangspassung";
  const kenn = art === "Spielpassung"
    ? `S_min=${Smin} µm / S_max=${Smax} µm`
    : `${-Smax <= 0 ? "S" : "Ü"}_Werte: Spiel max=${Smax} µm, Übermaß max=${-Smin} µm`;
  return `Ø${dNom} ${boreGrade}/${shaftGrade}: Bohrung EI=${EI} µm, ES=+${ES} µm, D_min=${fmt(dNom * 1000 + EI)} mm, D_max=${fmt(dNom * 1000 + ES)} mm | Welle es=${es >= 0 ? "+" + es : es} µm, ei=${ei >= 0 ? "+" + ei : ei} µm, d_max=${fmt(dNom * 1000 + es)} mm, d_min=${fmt(dNom * 1000 + ei)} mm | ${art} | ${kenn}`;
}

function precomputeFits(question) {
  const found = [];
  const re = /[Øø\s(]([0-9]{1,3}(?:,[0-9])?)\s*(?:mm)?\s*(H[5-9]|h[5-9]|k[4-7]|g[5-7]|f[6-8]|e[6-8]|js[5-8])\b(?:\s*\/\s*([Hh][5-9]|[kgefb][4-9]|js[5-8]))?/g;
  let m;
  while ((m = re.exec(question)) !== null) {
    const d = parseFloat(m[1].replace(",", "."));
    const g1 = m[2], g2 = m[3];
    found.push([d, g1, g2]);
  }
  const lines = [];
  const seen = new Set();
  for (const [d, g1, g2] of found) {
    const pairs = [];
    const isBore = /^H/.test(g1);
    const bg = isBore ? g1 : null;
    const sg = !isBore ? g1 : g2 || null;
    if (isBore) {
      for (const s of [sg || "h6", "k6", "g6", "f7"]) pairs.push([d, bg, s]);
    } else {
      for (const b of ["H7"]) pairs.push([d, b, sg]);
    }
    for (const [dd, b, s] of pairs) {
      const key = `${dd}-${b}-${s}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const r = fitResult(dd, b, s);
      if (r) lines.push(r);
    }
  }
  return lines.length
    ? `\n\nVORBEBERECHNETE PASSUNGEN (exakt per Code nach ISO 286 gerechnet – ÜBERNIMM diese Werte 1:1, rechne Passungen NICHT selbst):\n${lines.map((l) => "- " + l).join("\n")}`
    : "";
}

const SYSTEM_PROMPT = `Du bist der HAINBUCH Technical Advisor – der offizielle technische Berater von HAINBUCH Spanntechnik (www.hainbuch.com).

STRENGE REGELN:
1. Du beantwortest AUSSCHLIESSLICH Fragen rund um HAINBUCH: Spanntechnik, Spannmittel, Spannsysteme, Werkstückspannung, Zerspanung mit HAINBUCH-Produkten, Arbeitsplanung, Passungen, Fachkunde im Kontext von Spanntechnik.
2. AUSNAHME: Hochgeladene Bilder, Zeichnungen, Fotos oder Screenshots des Nutzers analysierst du IMMER vollständig – sie sind Teil seiner Spannaufgabe und gelten als HAINBUCH-bezogen.
3. Bei JEDEM anderen Thema (Politik, Sport, Coding, Kochen, allgemeines Wissen ohne HAINBUCH-Bezug usw.) antwortest du NUR kurz: "Ich bin der HAINBUCH Technical Advisor und beantworte ausschließlich Fragen rund um HAINBUCH Spanntechnik. Wie kann ich Ihnen bei Ihrer Spannaufgabe helfen?"
3. INTERNETRECHERCHE (aktiv nutzen!): Suche bei Bedarf im gesamten Internet.
   - HAINBUCH-Produkte, Verfügbarkeit, Neuheiten, Preise-Vermeidung: bevorzugt www.hainbuch.com und shop.hainbuch.com.
   - Allgemeine Technik für die Auslegung: Normen (ISO 286, DIN …), Schnittdaten-/Werkstoff-Richtwerte, Maschinengrenzwerte, Passungspraxis – hier darf das GANZE Web genutzt werden (Herstellerportale, Normen-Tabellen, Fachartikel).
   - Zahlen aus dem Web mit Quelle nennen; unsichere Quellen kennzeichnen.
   - Schließe die Antwort mit "## Quellen" ab: die wichtigsten Links als [Titel](URL), max. 5.
4. Nutze die dir mitgegebenen HAINBUCH-Informationen als Grundlage und nenne die passende HAINBUCH-Produktseite als Quelle.

FACHGEBIETE: Spannfutter (SPANNTOP, TOPlus, TOROK, InoFlex, B-Top), Spanndorne (MANDO, MAXXOS), Spanntechnik für Drehen/Fräsen/Schleifen, Automation, Auslegung von Spannsituationen (Spannkraft, 6-Punkte-Regel, Bezugssystem), Arbeitsplanung mit ISO-Zeiten, Passungen nach ISO 286, Werkstoffe für die Zerspanung, Fachkunde.

ABLAUF DER BERATUNG (2-STUFIGER PROZESS - STRIKTE PFLICHT):

STUFE 1 - ERSTKONTAKT / BESTANDSKLÄRUNG:
- Wenn der Kunde sein Werkstück / seine Fertigungsaufgabe beschreibt, aber NOCH NICHT gesagt hat, welches Spannfutter er besitzt:
- Gib eine kurze, kompetente technische Einleitung (1–2 Sätze zur Geometrie/Werkstoff, z. B. kurze Nennung der ISO 286 Passungsgrenzmaße).
- Stelle DANN ZWINGEND ALS NÄCHSTEN SCHRITT DIE BESTANDSFRAGE:
  "Haben Sie bereits ein Spannfutter bzw. HAINBUCH-Spannmittel in Ihrer Fertigung (z. B. SPANNTOP, TOPlus, MANDO, InoFlex, B-Top, MANOK) – oder soll ich Ihnen passende Optionen vorschlagen?"
- STOPP HIER! Gib in Stufe 1 KEINEN vollständigen Arbeitsplan, KEINE Stückliste und KEINE 5-Lösungen-Tabelle aus. Warte auf die Antwort des Kunden!

STUFE 2 - NACH DER KUNDENANTWORT:
- FALL A (Kunde besitzt bereits ein HAINBUCH-Futter / nennt Bestand, z. B. SPANNTOP, TOPlus, B-Top):
  * Passe die GESAMTE Auslegung zu 100 % an das VORHANDENE Futter an!
  * Zeige, wie das vorhandene Basis-Spannmittel optimal genutzt wird (passende Spannköpfe, Segmentbüchsen, Aufsatzbacken, MANDO Adapt Dorn-Adaption für Bohrungen, Längsanschläge).
  * Erstelle den vollständigen Arbeitsplan (OP 10 & OP 20) speziell für dieses vorhandene Futter inklusive Schnittdaten, ISO-Hauptzeiten (t_h), Anti-Polygon-Spannkraftanalyse, Werkzeugen und Werkstatt-Einrichteblatt!
- FALL B (Kunde hat kein Futter / bittet um Optionen / "schlag mir vor"):
  * Präsentiere die 3–5 besten HAINBUCH-Lösungen mit echten Produktfotos, Vergleichstabelle, vollständigem Arbeitsplan (OP 10/OP 20), Schnittdaten, ISO-Hauptzeiten, Werkzeugen, Anti-Polygon-Check, ROI und Werkstatt-Einrichteblatt!
- FALL C (Kunde hat ein Fremdfutter / noch kein HAINBUCH-Spannmittel):
  * Aktive HAINBUCH-Komplettberatung: Zeige auf, wie HAINBUCH-Systeme (SPANNTOP, InoFlex, MANDO, centroteX) über Zwischenflansche auf JEDE Werkzeugmaschine (Drehen & Fräsen) montiert werden.
  * Stelle das passende HAINBUCH-Paket zusammen (Spannfutter, Flansch, Zugrohradapter, Spannköpfe, Wechselvorrichtung).
  * Frage gezielt die 5 Schlüsselparameter ab, um die exakten Materialnummern für die Maschinenanbindung zu ermitteln:
    1. Maschinenhersteller & Modell (z. B. DMG Mori, Mazak, Okuma, Haas).
    2. Spindelnase / Maschinenschnittstelle (z. B. Kurzkegel A2-5, A2-6, A2-8 oder T-Nutentisch).
    3. Zugrohrgewinde & Zylinder-Durchlass (für die Zugstangenanbindung).
    4. Werkstückabmessungen & Geometrie (z. B. Stangen-Ø oder Vierkant).
    5. Losgröße & Teilewechselhäufigkeit (zur Auslegung von centroteX Schnellwechselsystem vs. Standardflansch).
- Reine Rechen-/Fachfragen ohne Produktbezug (Passungen nach ISO 286, Schnittdaten, Zeiten) erfordern KEINE Bestandsfrage.

CNC- & SINUMERIK-PROGRAMMIER-REGELN (PFLICHT für lauffähigen NC-Code):
- NULLPUNKT-SYNCHRONISATION: Bei Fräsbearbeitungen auf Rundkörpern/Wellen (z. B. im MANOK) gilt einheitlich:
  * X0 = Anschlagfläche / Werkstückstirnseite links.
  * Y0 = Drehmitte der Welle (Achse).
  * Z0 = Drehmitte der Welle (Achse, Z=0). Referenzebene RFP = Werkstück-Radius (z. B. +12,5 mm bei Ø 25 mm), Nut-Endtiefe DP = Radius - Tiefe (z. B. +8,5 mm bei 4,0 mm Nuttiefe). Nullpunkt und Zyklenparameter müssen 100 % identisch definiert sein!
- PASSFEDERNUT-ZYKLUS: Bei tolerierten Passfedernuten (z. B. 8 P9 / DIN 6885) ist der Siemens-Zyklus 'SLOT1' (Längsnut mit Schruppen/Schlichten, seitlichem Schlichtaufmaß und Bahnkorrektur) oder 'POCKET3' zu verwenden (niemals einfacher 'LONGHOLE'-Zyklus ohne Aufmaß).
- NC-ANBOHREN AUF RUNDKÖRPERN: Tiefe des 90°-NC-Anbohrers exakt auf den Bohrerdurchmesser abstimmen (z. B. Anbohrtiefe 2,0–2,2 mm bei Ø 3,8 mm Bohrer), um eine plane Senkfläche auf dem Zylinderscheitel zu erzeugen und Verlauf zu verhindern.

ZEICHNUNGS-AUSLESE-REGELN (wichtig – häufige Fehler vermeiden):
- Ein Ø-Wert mit mehreren Bohrungen darauf (z. B. "4× Ø14 auf Ø100") ist ein TEILKREIS/LOCHKREIS – KEINE Bohrung Ø100! Für einen Teilkreis niemals Passungen oder Bohrungsbearbeitungen berechnen; es existiert nur der Lochkreis.
- Bohrungen können durch ZIRKULARFRÄSEN/Helical-Fräsen entstehen (nicht nur Bohren/Reiben) – das ist bei großen Durchmessern oder asymmetrischen Teilen oft die richtige Wahl und gehört mit Zeitformel in den Arbeitsplan.
- Prüfe jede Ø-Angabe: Ist es (a) eine echte Bohrung, (b) ein Außendurchmesser, (c) ein Teilkreis, (d) ein Radius? Erst danach Passungen/Bearbeitungen zuordnen.

BILDER & ZEICHNUNGEN: Der Nutzer kann technische Zeichnungen, Skizzen, Fotos von Werkstücken und Screenshots hochladen. Analysiere sie sorgfältig: Nennmaße, Toleranzen, Passungen, Werkstoffangaben, Oberflächen, Geometrie entnehmen und für Spannmittel-Empfehlung, Arbeitsplan und Berechnungen verwenden. Fehlende kritische Maße (z. B. Dicke) aktiv nachfragen. Beziehe die Analyse immer auf die HAINBUCH-Spannlösung.

Antworte präzise, sachlich und praxisnah auf Deutsch (oder in der Sprache des Nutzers).
Nenne KEINE Preise – der Kunde erhält Preise nur über ein offizielles HAINBUCH-Angebot.

ANTWORT-TIEFE (PFLICHT - HIGHEST ENGINEERING STANDARDS):
1. Produkt-Empfehlungen: Enumeriere ALLE passenden Lösungen – vollständig, nicht auf 3–4 begrenzt! Gehe das gesamte HAINBUCH-Portfolio systematisch durch und gruppiere nach Spannprinzip: (a) Außenspannung rund (SPANNTOP nova/mini Kombi Axzug/Axfix/Modular, TOPlus, MANOK plus), (b) Außenspannung prismatisch/unregelmäßig (InoFlex VF/VD/VT-S, B-Top/B-Top3 mit Backen, Zentrierschraubstock), (c) Innenspannung (MANDO/MANDO Adapt, MAXXOS, Spannbüchsen), (d) Wechselsysteme (centroteX S/M, monteq, Wechselvorrichtungen), (e) Sonderfälle (Magnetmodul, Mehrfachspannplatten bei Serien).
GRÖSSEN-DISZIPLIN: Wähle Baugrößen AUSSCHLIESSLICH nach dem Spannbereich aus dem Katalog-Kontext (z. B. MANDO T212: Gr. 3 = Ø50–80 mm, Gr. 4 = Ø69–100 mm, Gr. 5 = Ø100–130 mm). Nenne zu jeder Baugröße ihren Spannbereich und prüfe: Liegt der Werkstückdurchmesser wirklich darin? Eine Größe außerhalb des Spannbereichs ist ein HARTER FEHLER.
MAT-NUMMER-DISZIPLIN: Eine Materialnummer nur dann nennen, wenn Titel UND Größe im Kontext exakt zum genannten Produkt passen.
Jede Lösung muss VOLLSTÄNDIG sein: ALLE benötigten Teile auflisten (Grundkörper/Spannfutter, Backen bzw. Spannbüchsen, Adaptation, Anschläge, Wechselvorrichtung, Zubehör – konkret mit Bezeichnung aus den Shop-Produktdaten).

2. BERECHNUNGEN (Vollständige Formeln & Zahlen):
- Passungen nach ISO 286 mit ALLEN Grenzmaßen und Abmaßen für Bohrung UND Welle plus Höchst-/Mindestspiel und Höchst-/Mindestübermaß.
- SPANNKRAFT- & VERZUGSANALYSE (Anti-Polygon-Check): Berechne und diskutiere die Bauteilverformung unter Spannkraft. Vergleiche 3-Backenspannung (Dreiecksverzug bis zu 15–30 µm bei Dünnwandteilen) mit HAINBUCH 360°-Vollumschlingung / InoFlex 4-Punkt-Ausgleich (< 3 µm Verformung) und nenne die empfohlene maximale Radialspannkraft F_sp.
- Arbeitspläne: Alle Schnittdaten (vc, n, f, vf, ap/ae) mit Formeln und ISO-Hauptzeiten (t_h = L / vf) je Operation.

3. KONKRETE WERKZEUGE & SCHNEIDSTOFFE:
- Nenne für jede Operation das konkrete Werkzeug und ISO-Wendeschneidplattentyp (z. B. Schruppen: CNMG 120408 / WNMG 080408 mit PVD TiAlN; Schlichten: CCMT 09T304 mit scharfer Positiv-Schneide / VHM-Reibahle).
- Kühlschmierstoff-Empfehlung (z. B. Innenkühlung p >= 20 bar / 8–10 % Emulsion).

4. WIRTSCHAFTLICHKEIT & ROI-VERGLEICH (Zeit- und Geldersparnis):
- Vergleiche konventionelles Dreibackenfutter vs. HAINBUCH-System:
  * Rüstzeitersparnis (von ca. 45 min auf < 2 min mit centroteX).
  * Ausschussreduktion (von 5–8 % Verzugsausschuss auf < 0,5 %).
  * Zeit- und Kostenersparnis bei der genannten Losgröße (Basis: 90–100 €/h Maschinenstundensatz).

5. WERKSTATT-EINRICHTEBLATT (Setup Sheet):
- Kompakte Übersicht für die Werkstatt: Nullpunkte (G54 für OP 10, G55 für OP 20), Werkzeugtabelle mit T-Nummern, Drehzahlen und Anzugsmomente.

6. PFLICHT ohne Ausnahme: Jede Lösung MUSS ihr Produktfoto direkt eingebettet enthalten: ![Produktname](URL) – nutze die hero-img/shop-img URLs aus dem Kontext. Kein Foto nur beschreiben oder als Textzeile andeuten – IMMER die Markdown-Bildsyntax.
7. Links immer als [Text](URL) schreiben, niemals roh als "[src: …]".
8. Passungsarten fachlich korrekt klassifizieren: H7/h6 = Spielpassung, H7/k6 = Übergangspassung, H7/p6 = Presspassung (usw. nach ISO 286).

FORMAT-REGELN (wichtig):
- Struktur mit Markdown: "##" für Zwischenüberschriften, **fett** für wichtige Begriffe, Listen mit "-".
- TABELLEN-REGEL: Kompakte Tabellen mit MAXIMAL 5 Spalten. Lösungen als ZEILEN, Kriterien als SPALTEN. In jede Zelle nur kurze Werte (Zahl + Einheit), keine Sätze, keine Zeilenumbrüche in Zellen. Langtext gehört in Stichpunkte UNTER die Tabelle.
- FOTO-REGEL (PFLICHT): Jede Lösung bekommt EXAKT EIN Produktfoto direkt unter ihrer Überschrift als Markdown-Bild:
  ![SPANNTOP nova Kombi Axzug](http://localhost:3002/hero-img/hero_94.jpg)
- KEIN LaTeX, KEINE $-Zeichen.
- Formeln in klarem Klartext: "ES = +0,025 mm" oder "P_max = ES − ei = 0,023 mm" oder "t_h = L / vf = 240 / 388 = 0,62 min".
- Dezimaltrennzeichen: Komma (45,025 mm). Einheiten mit Leerzeichen (25 µm). Unicode: Ø, µm, ×, −, →, ≈.`;

function emit(res, obj) {
  res.write(JSON.stringify(obj) + "\n");
}

function cleanLaTeX(t) {
  let s = t;
  s = s.replace(/\\varnothing/g, "Ø");
  s = s.replace(/\\(mu|pi|Omega|sigma)\\text\{([^}]*)\}/g, (m, g, r) => ({mu:"µ",pi:"π",Omega:"Ω",sigma:"σ"}[g]) + r);
  s = s.replace(/\\ddot\{U\}/g, "Ü").replace(/\\ddot\{u\}/g, "ü")
       .replace(/\\ddot\{O\}/g, "Ö").replace(/\\ddot\{o\}/g, "ö")
       .replace(/\\ddot\{A\}/g, "Ä").replace(/\\ddot\{a\}/g, "ä");
  s = s.replace(/\\text\{([^}]*)\}/g, "$1");
  s = s.replace(/\\mathrm\{([^}]*)\}/g, "$1");
  s = s.replace(/\\mathbf\{([^}]*)\}/g, "$1");
  s = s.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, "$1 / $2");
  s = s.replace(/_\{([^}]*)\}/g, "_$1").replace(/\^\{([^}]*)\}/g, "^$1");
  s = s.replace(/\\circ/g, "°").replace(/\\times/g, "×").replace(/\\cdot/g, "·")
       .replace(/\\pm/g, "±").replace(/\\le\b/g, "≤").replace(/\\ge\b/g, "≥")
       .replace(/\\approx/g, "≈").replace(/\\rightarrow/g, "→").replace(/\\to\b/g, "→")
       .replace(/\\Rightarrow/g, "=>").replace(/\\mu(?![a-zA-Z])/g, "µ").replace(/\\pi\b/g, "π")
       .replace(/\\deg/g, "°").replace(/\\max/g, "max").replace(/\\min/g, "min")
       .replace(/\^\s*°/g, "°");
  s = s.replace(/\\left|\\right/g, "");
  s = s.replace(/\\[,\s;!]/g, " ");
  s = s.replace(/\\\$/g, "$");
  s = s.replace(/  +/g, " ");
  // Auto-correct any hero image mismatches in markdown sections
  s = s.replace(/(###[^\n]*TOPlus\s+mini[^\n]*\n[\s\S]*?)hero_\d+\.jpg/gi, '$1hero_28.jpg');
  s = s.replace(/(###[^\n]*TOPlus\s+(?:nova|premium|kombi)[^\n]*\n[\s\S]*?)hero_\d+\.jpg/gi, '$1hero_60.jpg');
  s = s.replace(/(###[^\n]*InoFlex[^\n]*\n[\s\S]*?)hero_(?:372|458|94)\.jpg/gi, '$1hero_136.jpg');
  s = s.replace(/(###[^\n]*MANOK[^\n]*\n[\s\S]*?)hero_(?:338|458|94)\.jpg/gi, '$1hero_246.jpg');
  s = s.replace(/(###[^\n]*MANDO\s+T21[12][^\n]*\n[\s\S]*?)hero_(?:124|254|94|372)\.jpg/gi, '$1hero_178.jpg');
  s = s.replace(/(###[^\n]*MANDO\s+Adapt[^\n]*\n[\s\S]*?)hero_(?:124|254|94|372)\.jpg/gi, '$1hero_272.jpg');
  s = s.replace(/(###[^\n]*B-Top[^\n]*\n[\s\S]*?)hero_(?:404|458|94)\.jpg/gi, '$1hero_146.jpg');
  return s;
}

async function handleChat(req, res) {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Accel-Buffering", "no");

    let messages;
    try {
      const parsed = JSON.parse(body);
      if (!Array.isArray(parsed.messages) || parsed.messages.length === 0) throw new Error();
      messages = parsed.messages.slice(-20).map((m) => {
        const role = m.role === "model" ? "assistant" : m.role;
        if (Array.isArray(m.parts)) {
          const text = m.parts
            .map((p) => p.text || "")
            .filter(Boolean)
            .join("\n")
            .slice(0, 20000);
          const images = m.parts
            .filter((p) => p.inlineData && String(p.inlineData.mimeType || "").startsWith("image/"))
            .slice(0, 4)
            .map((p) => ({
              type: "image_url",
              image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` },
            }));
          if (images.length) {
            return { role, content: [{ type: "text", text: text || "Bitte analysiere das angehängte Bild." }, ...images] };
          }
          return { role, content: text };
        }
        return { role, content: String(m.content ?? "").slice(0, 20000) };
      }).filter((m) => (typeof m.content === "string" ? m.content : m.content.length));
    } catch {
      res.write(JSON.stringify({ error: "messages missing" }) + "\n");
      return res.end();
    }

    const lastQuestion = [...messages]
      .reverse()
      .find((m) => m.role === "user");
    const questionText =
      typeof lastQuestion?.content === "string"
        ? lastQuestion.content
        : Array.isArray(lastQuestion?.content)
          ? lastQuestion.content.filter((c) => c.type === "text").map((c) => c.text).join(" ")
          : "";
    const allMessagesText = messages
      .map((m) =>
        typeof m.content === "string"
          ? m.content
          : Array.isArray(m.content)
            ? m.content
                .filter((c) => c.type === "text")
                .map((c) => c.text)
                .join(" ")
            : ""
      )
      .join(" ");
    const combinedQuery = `${questionText} ${allMessagesText}`.trim();
    const context = buildContext(combinedQuery);
    const shopHits = retrieveShop(combinedQuery);
    let shopContext = "";
    if (shopHits.length) {
      const lines = shopHits.map(
        (p) =>
          `- ${p.title} (Kategorie: ${p.category}) | Foto: ![${p.title}](${BASE_URL}/shop-img/${p.image})`
      );
      shopContext = `\n\nKONKRETE HAINBUCH-SHOP-PRODUKTE MIT FOTO ZU DIESER ANFRAGE (Foto-URLs direkt einbinden):\n${lines.join("\n")}`;
    }
    const catalogHits = retrieveCatalog(combinedQuery);
    const precomputed = precomputeFits(combinedQuery);
    let fitsContext = precomputed;
    let catalogContext = "";
    if (catalogHits.length) {
      const lines = catalogHits.map((p) => {
        const hero = getHeroForProduct(p.name);
        const img = hero ? ` | Foto: ![${p.name}](${BASE_URL}/hero-img/${hero})` : "";
        return `- ${p.name}${p.fields ? " | Technische Daten: " + catalogText(p) : ""} | Materialnummern: ${(p.matnr || []).join(", ") || "—"}${img}`;
      });
      catalogContext = `\n\nHAINBUCH-KATALOG-PRODUKTE MIT OFFIZIELLEN TECHNISCHEN DATEN (maßgeblich – diese Werte in Tabellen übernehmen; Fotos direkt einbinden):\n${lines.join("\n")}`;
    }
    const goldContext = retrieveGoldStandards(combinedQuery);
    const heartbeat = setInterval(() => emit(res, { type: "ping" }), 15000);
    try {
      emit(res, { type: "status", stage: "chat", label: "HAINBUCH-Wissen wird durchsucht…" });
      const upstream = await fetch(LLM_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL_ID,
          messages: [
            { role: "system", content: SYSTEM_PROMPT + goldContext + fitsContext + catalogContext + shopContext + context },
            ...messages,
          ],
          tools: [{ google_search: {} }],
        }),
        signal: AbortSignal.timeout(600000),
      });
      const json = await upstream.json();
      const answer =
        cleanLaTeX(
          json.choices?.[0]?.message?.content ??
            "Es ist ein Fehler bei der Modellabfrage aufgetreten. Bitte versuche es erneut."
        );

    const startTime = Date.now();
    emit(res, { type: "status", stage: "chat", label: "Qualitätsprüfung der Auslegung…" });
    let finalAnswer = answer;
    try {
      const qa = await fetch(LLM_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL_ID,
          messages: [
            { role: "system", content: "Du bist ein strenger QA-Prüfer für HAINBUCH-Auslegungen. Prüfe den Entwurf gegen diese Checkliste und korrigiere alle Mängel direkt:\n0) STRIKTER 2-STUFIGER ABLAUF (PFLICHT):\n- STUFE 1 (Erstkontakt / Bestand unklar): Wenn der Nutzer das Werkstück neu beschreibt und noch KEIN Futter genannt hat und noch NICHT nach Optionen gefragt hat: Der Entwurf MUSS kurz sein (1-2 Sätze technische Einleitung/Passungen) und ZWINGEND mit der Bestandsfrage enden: 'Haben Sie bereits ein Spannfutter bzw. HAINBUCH-Spannmittel in Ihrer Fertigung (z. B. SPANNTOP, TOPlus, MANDO, InoFlex, B-Top, MANOK) – oder soll ich Ihnen passende Optionen vorschlagen?'. Falls der Entwurf fälschlicherweise schon den vollen Arbeitsplan enthält, KÜRZE ihn und füge die Bestandsfrage ein!\n- STUFE 2 (Nach Kundenantwort): Wenn der Kunde sein Futter nennt (z. B. 'habe SPANNTOP nova'), MUSS die Auslegung zu 100% auf dieses Futter angepasst sein (Spannköpfe, Dorn-Adaption MANDO Adapt, Arbeitsplan, Werkzeuge)! Wenn der Kunde kein Futter hat / nach Optionen fragt ('schlag mir vor'), MUSS die vollständige Auslegung mit 3-5 Lösungen, Arbeitsplan, Schnittdaten, ISO-Zeiten, Werkzeugen, Anti-Polygon-Check, ROI und Fotos enthalten sein!\n1) ECHTE und PASSENDE Markdown-Fotos ![Name](URL) (InoFlex -> hero_136.jpg / hero_262.jpg, B-Top -> hero_146.jpg / hero_150.jpg, centroteX -> hero_242.jpg, MANOK plus -> hero_246.jpg, MANOK -> hero_242.jpg, MANDO -> hero_178.jpg, MANDO Adapt -> hero_272.jpg, SPANNTOP nova -> hero_94.jpg, SPANNTOP mini -> hero_74.jpg; NIEMALS falsche Bilder wie Kran für InoFlex oder Messkoffer für Spannfutter kopieren!).\n2) Tabellen max. 5 Spalten, Lösungen als Zeilen.\n3) KEIN LaTeX, keine $-Zeichen; Formeln im Klartext (z. B. t_h = L / vf); deutsche Komma-Dezimalzahlen.\n4) Passungswerte aus dem VORBEBERECHNETEN Block 1:1 übernehmen; alle Rechnungen nachprüfen und Fehler korrigieren.\n5) Abschließend Sektion '## Quellen' mit klickbaren [Titel](URL)-Links (min. 2).\nAntworte NUR mit der vollständigen korrigierten finalen Antwort – kein Kommentar, keine Begründung der Änderungen." },
            { role: "user", content: `NUTZERFRAGE:\n${questionText}\n\nVORBEBERECHNETE PASSUNGEN:\n${precomputed || "—"}\n\nKATALOG-KONTEXT:\n${catalogContext || "—"}\n\nSHOP-KONTEXT:\n${shopContext || "—"}\n\nENTWURF ZU PRÜFEN:\n${answer}` },
          ],
          tools: [{ google_search: {} }],
        }),
        signal: AbortSignal.timeout(600000),
      });
      const qj = await qa.json();
      const fixed = qj.choices?.[0]?.message?.content;
      if (fixed && fixed.length > 500) finalAnswer = fixed;
    } catch {}
    const cleaned = cleanLaTeX(finalAnswer);
    const imagesCited = (cleaned.match(/!\[[^\]]*\]\(([^)]+)\)/g) || []);
    logChatInteraction({
      ip: req.socket?.remoteAddress || "local",
      country: req.headers["cf-ipcountry"] || null,
      messages,
      question: questionText,
      response: cleaned,
      imagesCited,
      durationMs: Date.now() - startTime,
      stage: "success",
    });
    emit(res, { type: "result", data: { message: cleaned } });
    } catch (e) {
      logChatInteraction({
        ip: req.socket?.remoteAddress || "local",
        country: req.headers["cf-ipcountry"] || null,
        messages,
        question: questionText,
        error: e.message || "LLM-Fehler",
        durationMs: Date.now() - startTime,
        stage: "error",
      });
      emit(res, { type: "error", error: e.message || "LLM-Fehler" });
    } finally {
      clearInterval(heartbeat);
      res.end();
    }
  });
}

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-app-key, x-admin-key, x-request-id");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }
  if (req.method === "GET" && (req.url === "/api/status" || req.url === "/health")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({
      model: MODEL_ID,
      llmOnline: true,
      mode: "hainbuch-gemini-only",
      kb: KB.length,
      country: typeof req.headers["cf-ipcountry"] === "string"
        ? req.headers["cf-ipcountry"].toUpperCase()
        : null,
    }));
  }
  if (req.method === "GET" && (req.url.startsWith("/hero-img/") || req.url.startsWith("/shop-img/"))) {
    const file = path.basename(decodeURIComponent(req.url.replace(/^\/(hero-img|shop-img)\//, '')));
    const heroFull = path.join(HERO_DIR, file);
    const shopFull = path.join(SHOP_DIR, file);
    const resolved = fs.existsSync(heroFull) ? heroFull : (fs.existsSync(shopFull) ? shopFull : null);
    if (!resolved) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" });
    return fs.createReadStream(resolved).pipe(res);
  }
  if (req.method === "POST" && req.url === "/api/chat") {
    if (APP_KEY && req.headers["x-app-key"] !== APP_KEY) {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "unauthorized" }));
    }
    if (rateLimited(req, res)) return;
    return handleChat(req, res);
  }
  if (req.method === "POST" && req.url === "/api/feedback") {
    if (APP_KEY && req.headers["x-app-key"] !== APP_KEY) {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "unauthorized" }));
    }
    if (rateLimited(req, res)) return;
    let fbBody = "";
    req.on("data", (c) => (fbBody += c));
    req.on("end", () => {
      let rating = null, message = "";
      try { const p = JSON.parse(fbBody || "{}"); rating = p.rating; message = p.message; } catch {}
      if (rating !== "up" && rating !== "down") {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "rating must be up|down" }));
      }
      const entry = {
        ts: new Date().toISOString(),
        rating,
        message: typeof message === "string" ? message.slice(0, 2000) : "",
        country: typeof req.headers["cf-ipcountry"] === "string" ? req.headers["cf-ipcountry"] : null,
      };
      fs.appendFile(path.join(__dirname, "feedback.jsonl"), JSON.stringify(entry) + "\n", (err) => {
        if (err) console.error("[Feedback]", err);
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }
  if (req.method === "GET" && req.url === "/api/admin") {
    if (!isLoopback(req)) {
      if (process.env.ALLOW_REMOTE_ADMIN !== "1" || !ADMIN_KEY || req.headers["x-admin-key"] !== ADMIN_KEY) {
        res.writeHead(req.headers["x-admin-key"] ? 401 : 403, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "localhost only" }));
      }
    }
    let feedback = [];
    try {
      feedback = fs.readFileSync(path.join(__dirname, "feedback.jsonl"), "utf8").trim().split("\n").slice(-50).map((l) => JSON.parse(l));
    } catch { /* none yet */ }
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ feedback, dayBudget, ratePerHour: RATE_PER_HOUR, ratePerDay: RATE_PER_DAY, rateBucketIps: rateBuckets.size }));
  }

  // Statische Auslieferung der gebauten UI (dist/) + SPA-Fallback
  if (req.method === "GET") {
    const urlPath = decodeURIComponent(req.url.split("?")[0]);
    const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
    const full = path.normalize(path.join(__dirname, "dist", rel));
    const candidates = fs.existsSync(full) && fs.statSync(full).isFile()
      ? [full]
      : [path.join(__dirname, "dist", "index.html")];
    const file = candidates[0];
    if (fs.existsSync(file)) {
      const types = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".ico": "image/x-icon",
        ".json": "application/json",
        ".webmanifest": "application/manifest+json",
        ".woff2": "font/woff2",
      };
      const type = types[path.extname(file).toLowerCase()] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": type, "Cache-Control": file.endsWith("index.html") ? "no-cache" : "public, max-age=3600" });
      return fs.createReadStream(file).pipe(res);
    }
  }
  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => console.log(`HAINBUCH Gemini-only API auf http://localhost:${PORT}`));
