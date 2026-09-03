const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// Load .env for manual runs (supervisor exports real env in production;
// dotenv is already a dependency). Never crashes if missing.
try { require("dotenv").config(); } catch {}

// Crash visibility: log the stack into the (persistent) log instead of dying
// silently — the supervisor only sees a dead port and restarts blindly.
process.on("uncaughtException", (err) => {
  console.error(`[fatal] uncaughtException: ${err && err.stack || err}`);
});
process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.stack : String(reason);
  console.error(`[fatal] unhandledRejection: ${msg}`);
});

// History + auth (Phase 1: email stub, Phase 2: Firebase). Guarded so the
// chat pipeline keeps working even if the DB can't open.
let histDb = null;
let histAuth = null;
try { histDb = require("./lib/db.cjs"); } catch (e) { console.warn("[history] db module unavailable:", e.message); }
try { histAuth = require("./lib/auth.cjs"); } catch (e) { console.warn("[history] auth module unavailable:", e.message); }

const PORT = process.env.PORT || 3002;
const LLM_URL = process.env.LLM_URL || "http://127.0.0.1:8317/v1/chat/completions";
const MODEL_ID = process.env.MODEL_ID || "gemini-3.8-flash-medium";
const APP_KEY = process.env.APP_KEY || "";
const KB_PATH =
  process.env.KB_PATH ||
  path.join(__dirname, "data", "hainbuch_products.json");
const IMG_PATH = process.env.IMG_PATH || path.join(__dirname, "hainbuch-images.json");
const SHOP_DIR = process.env.SHOP_DIR || path.join(__dirname, "catalog", "shop");
const SHOP_JSON = process.env.SHOP_JSON || path.join(__dirname, "catalog", "shop_accessories.json");
const CATALOG_JSON = process.env.CATALOG_JSON || path.join(__dirname, "catalog", "products_de.json");
const MAP_JSON = process.env.MAP_JSON || path.join(__dirname, "catalog", "map.json");
const HERO_DIR = path.join(__dirname, "catalog");
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const ADMIN_KEY = process.env.ADMIN_KEY || "";
// Default secure: loopback is NOT trusted unless explicitly enabled.
// Cloudflared delivers every public request via loopback, so TRUST_LOOPBACK=1
// would exempt the whole live site from rate limits AND open /api/admin.
const TRUST_LOOPBACK = process.env.TRUST_LOOPBACK === "1";
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

// Per-visitor IP behind Cloudflare / reverse proxies. All quick-tunnel traffic
// arrives via loopback, so the raw socket IP would put every visitor in ONE
// global bucket. Prefer the Cloudflare / proxy headers (set by the edge, not
// by the client) and fall back to the socket address.
function clientIp(req) {
  const cf = req.headers["cf-connecting-ip"];
  if (typeof cf === "string" && cf.trim()) return cf.trim().slice(0, 64);
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.trim()) return xff.split(",")[0].trim().slice(0, 64);
  const xr = req.headers["x-real-ip"];
  if (typeof xr === "string" && xr.trim()) return xr.trim().slice(0, 64);
  return (req.socket && req.socket.remoteAddress) || "unknown";
}

function rateLimited(req, res) {
  if (TRUST_LOOPBACK && isLoopback(req)) return false;
  const ip = clientIp(req);
  const now = Date.now();
  const hits = (rateBuckets.get(ip) || []).filter((t) => now - t < 3_600_000);
  const deny = (msg, retryAfterSec) => {
    res.writeHead(429, { "Content-Type": "application/json", "Retry-After": String(retryAfterSec) });
    res.end(JSON.stringify({ error: msg }));
    return true;
  };
  if (hits.length >= RATE_PER_HOUR) {
    const retryAfter = Math.max(1, Math.ceil((hits[0] + 3_600_000 - now) / 1000));
    return deny("Zu viele Anfragen — bitte in einer Stunde erneut versuchen.", retryAfter);
  }
  const today = new Date().toISOString().slice(0, 10);
  if (dayBudget.day !== today) dayBudget = { day: today, used: 0 };
  if (dayBudget.used >= RATE_PER_DAY) {
    const midnight = new Date(`${today}T24:00:00Z`).getTime();
    return deny("Tagesbudget erreicht — bitte morgen erneut versuchen.", Math.max(1, Math.ceil((midnight - now) / 1000)));
  }
  hits.push(now);
  rateBuckets.set(ip, hits);
  dayBudget.used++;
  return false;
}

// Dedicated feedback bucket: thumbs are best-effort, never allowed to eat
// chat quota — and chat floods must not kill feedback either.
const FEEDBACK_MAX_PER_HOUR = Number(process.env.FEEDBACK_MAX_PER_HOUR || 60);
const fbBuckets = new Map();
function feedbackLimited(req, res) {
  if (TRUST_LOOPBACK && isLoopback(req)) return false;
  const ip = clientIp(req);
  const now = Date.now();
  const hits = (fbBuckets.get(ip) || []).filter((t) => now - t < 3_600_000);
  if (hits.length >= FEEDBACK_MAX_PER_HOUR) {
    const retryAfter = Math.max(1, Math.ceil((hits[0] + 3_600_000 - now) / 1000));
    res.writeHead(429, { "Content-Type": "application/json", "Retry-After": String(retryAfter) });
    res.end(JSON.stringify({ error: "rate limited" }));
    return true;
  }
  hits.push(now);
  fbBuckets.set(ip, hits);
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

function retrieveShop(query, top = 20) {
  const terms = query
    .toLowerCase()
    .replace(/[^\wäöüß\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t))
    .slice(0, 12);
  if (!terms.length) return [];
  // Tiny LRU-style cache: repeated follow-ups ("und davon die größte?") reuse results.
  const cacheKey = terms.slice().sort().join("|") + "#" + top;
  const cached = retrieveShop._cache?.get(cacheKey);
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
  if (!retrieveShop._cache) retrieveShop._cache = new Map();
  retrieveShop._cache.set(cacheKey, out);
  if (retrieveShop._cache.size > 200) {
    const first = retrieveShop._cache.keys().next().value;
    retrieveShop._cache.delete(first);
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
  // Longest keys first so "spanntop nova kombi axzug" wins over "spanntop nova".
  const keys = Object.keys(CANONICAL_HERO).sort((a, b) => b.length - a.length);
  for (const k of keys) {
    if (lower.includes(k)) return CANONICAL_HERO[k];
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

// Small JSON-body reader for the history/auth API (separate from the
// streaming chat handler below).
function readJsonBody(req, limit = 256 * 1024) {
  return new Promise((resolve) => {
    let body = "";
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    req.on("data", (c) => {
      if (done) return;
      body += c;
      if (body.length > limit) {
        try { req.destroy(); } catch {}
        finish({ __tooLarge: true });
      }
    });
    req.on("end", () => {
      if (done) return;
      try { finish(JSON.parse(body || "{}")); } catch { finish({ __invalid: true }); }
    });
    req.on("error", () => finish({ __invalid: true }));
  });
}

// Persist one chat turn to SQLite (users → conversations → messages).
// Never throws, never blocks chat on failure. Returns conversationId or null.
async function persistChatTurn(req, parsed, questionText, cleaned, durationMs) {
  try {
    if (!histDb || !histDb.ok()) return null;
    const auth = histAuth ? await histAuth.getAuth(req).catch(() => null) : null;
    const email = histDb.normalizeEmail((parsed && parsed.email) || (auth && auth.email) || req.headers["x-user-email"]);
    let userId = (auth && auth.uid) || "";
    let user = userId ? histDb.getUserById(userId) : null;
    if (!user && email) user = histDb.getUserByEmail(email) || histDb.upsertUser({ email });
    if (!user && !email) return null; // anonymous guest: jsonl log only
    if (user) userId = user.id;
    const uiLang = String((parsed && parsed.uiLang) || req.headers["x-ui-lang"] || "").slice(0, 8);
    const country = String((parsed && parsed.country) || req.headers["cf-ipcountry"] || "").slice(0, 4);
    let convId = parsed && parsed.conversationId;
    if (convId) {
      const c = histDb.getConversation(convId, userId);
      if (!c) convId = null;
    }
    if (!convId) {
      const conv = histDb.createConversation({
        userId, title: String(questionText || "Beratung").slice(0, 120) || "Beratung",
        country, uiLang, machine: parsed && parsed.machine,
      });
      convId = conv && conv.id;
    }
    if (!convId) return null;
    histDb.addMessage({ conversationId: convId, role: "user", content: questionText });
    histDb.addMessage({ conversationId: convId, role: "assistant", content: cleaned, model: MODEL_ID, durationMs });
    return convId;
  } catch (e) {
    console.warn("[history] persist failed:", e.message);
    return null;
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

function precomputeFits(question) {
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
    // Case matters: uppercase H/P = bore, lowercase = shaft.
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
  * Aktive HAINBUCH-Komplettberatung & Wirtschaftlichkeitsbeweis:
    1. RECHNERISCHER VERGLEICH ZEIT & GELD (Pflicht):
       - Konventionelles Fremdfutter (Status quo): Rüstzeit ca. 45–60 min, Ausschussrisiko 5–15 % (Dreiecksverzug/Polygoneffekt bei Passungen), begrenzte Schnittwerte -> Rechnerische Gesamtkosten für das Los.
       - HAINBUCH-Lösung (SPANNTOP, InoFlex, MANDO, centroteX): Rüstzeit < 1 min, Ausschuss < 0,5 %, bis zu 20 % schnellere Schnittzeiten -> Rechnerische Gesamtzeit und Kosteneinsparung in Euro (Basis: 90–100 €/h).
       - Fazit-Satz: "Mit der HAINBUCH-Lösung sparen Sie bei Ihrem Los von [N] Stück konkret [Z] Stunden Fertigungszeit und [X] € Kosten (insb. durch vermiedenen Schrott und Rüstzeit)."
    2. MONTAGE- & ADAPTIONS-BERATUNG: Erkläre, dass HAINBUCH-Systeme über montagefertige Zwischenflansche auf JEDE Spindelnase montiert werden können.
    3. SCHLÜSSELPARAMETER ABFRAGEN: Frage die 5 Schlüsselparameter ab, um die montagefertigen Artikelnummern (Flansch, Zugrohradapter) zu bestimmen:
       (a) Maschinenhersteller & Modell (z. B. DMG Mori, Mazak, Okuma, Haas).
       (b) Spindelnase / Maschinenschnittstelle (z. B. Kurzkegel A2-5, A2-6, A2-8, DIN 55026 oder T-Nutentisch).
       (c) Zugrohrgewinde & Zylinder-Durchlass (für die Zugstangenanbindung).
       (d) Werkstückabmessungen & Geometrie (z. B. Stangen-Ø oder Vierkant).
       (e) Losgröße & Teilewechselhäufigkeit (zur Auslegung: Flanschanbau vs. centroteX 1-Minuten-Schnellwechsel).
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

FERTIGUNGSTECHNISCHE MATHEMATIK- & LÄNGENLOGIK (STRIKTE PFLICHT):
- GESAMTLÄNGE & ABSTECHEN (OP 10 -> OP 20):
  Berechne VOR der Arbeitsplan-Erstellung IMMER die ECHTE GESAMTLÄNGE des fertigen Werkstücks!
  Besteht ein Werkstück aus mehreren Längenabschnitten (z. B. Hülse L = 75 mm + anschließender Zapfen L = 25 mm -> Gesamtlänge = 100 mm):
  * Die Abstichlänge in OP 10 MUSS MINDESTENS der vollen Gesamtlänge zzgl. Bearbeitungsaufmaß entsprechen (z. B. Abstechen auf L ≥ 102–103 mm)!
  * Niemals auf die Teillänge eines einzelnen Abschnitts (z. B. 76 mm) abstechen, wenn in OP 20 weitere Abschnitte (Zapfen, Absätze) gefertigt werden müssen (sonst fehlen 24 mm Material und das Bauteil ist Schrott)!
  * Alternativ: Prüfe, ob die OP-Reihenfolge umgedreht werden muss (OP 10: Zapfen + Gewinde fertigen; OP 20: Am Zapfen/Körper spannen und Hülse ausdrehen).
- SACKLOCH-BEARBEITUNG vs. REIBEN:
  Eine Reibahle besitzt bauartbedingt einen Anschnitt (Fase/Konus) und kann eine Sacklochbohrung mit ebenem Grund oder kleinem Bodenradius (z. B. R0,3) NIEMALS scharfkantig bis auf den Grund auf Passmaß reiben!
  In solchen Fällen im Arbeitsplan IMMER eine Feindreh-Bohrstange (Schlicht-Bohrstange mit Feinkornhartmetall-/CBN-Platte) vorsehen, KEINE Reibahle!
- GPS- & FORM-TOLERANZEN (DIN EN ISO 1101):
  Reine Formtoleranzen (Rundheit, Zylindrizität, Geradheit, Ebenheit) dürfen laut ISO 1101 NIEMALS ein Bezugselement (z. B. | A) besitzen!
  Nur Lage- und Lauftoleranzen (Rundlauf, Gesamtlauf, Koaxialität, Rechtwinkligkeit, Position) haben Bezüge.

BILDER & ZEICHNUNGEN: Der Nutzer kann technische Zeichnungen, Skizzen, Fotos von Werkstücken und Screenshots hochladen. Analysiere sie sorgfältig: Nennmaße, Toleranzen, Passungen, Werkstoffangaben, Oberflächen, Geometrie entnehmen und für Spannmittel-Empfehlung, Arbeitsplan und Berechnungen verwenden. Fehlende kritische Maße (z. B. Dicke) aktiv nachfragen. Beziehe die Analyse immer auf die HAINBUCH-Spannlösung.

Antworte präzise, sachlich und praxisnah auf Deutsch (oder in der Sprache des Nutzers).

PREIS- & ANGEBOTS-DISZIPLIN:
- Nenne KEINE erfundenen oder geschätzten Mockup-Preise.
- Wenn der Kunde nach Preisen fragt: Erkläre, dass die verbindlichen Listenpreise, Firmenrabatte und tagesaktuellen Lieferzeiten direkt über den offiziellen HAINBUCH B2B-Online-Shop (https://shop.hainbuch.com) bzw. ein offizielles HAINBUCH-Angebot bereitgestellt werden. Die exportierte CSV-Stückliste (BOM) kann direkt dafür genutzt werden.

ANTWORT-TIEFE (PFLICHT - HIGHEST ENGINEERING STANDARDS):
1. Produkt-Empfehlungen & Spannköpfe: Enumeriere ALLE passenden Lösungen – vollständig, nicht auf 3–4 begrenzt! Gehe das gesamte HAINBUCH-Portfolio systematisch durch und gruppiere nach Spannprinzip: (a) Außenspannung rund (SPANNTOP nova/mini Kombi Axzug/Axfix/Modular, TOPlus, MANOK plus), (b) Außenspannung prismatisch/unregelmäßig (InoFlex VF/VD/VT-S, B-Top/B-Top3 mit Backen, Zentrierschraubstock), (c) Innenspannung (MANDO/MANDO Adapt, MAXXOS, Spannbüchsen), (d) Wechselsysteme (centroteX S/M, monteq, Wechselvorrichtungen), (e) Sonderfälle (Magnetmodul, Mehrfachspannplatten bei Serien).

KONKRETE SPANNKÖPFE & SCHNELLWECHSEL-SYSTEME (PFLICHT - NICHT NUR FUTTER NENNEN!):
- Nenne NIEMALS nur das Futter abstrakt, sondern IMMER den konkreten Spannkopf bzw. die Segmentspannbüchse mit Baugröße und Profil (z. B. Spannkopf TOPlus/SPANNTOP Gr. 65/80/100 mit Profil Vierkant/Rund/Sechskant/Weich ausdrehbar, oder MANDO Segmentspannbüchse Ø glatt/gerillt).
- Erkläre und betone IMMER die 3 schnellsten HAINBUCH Rüst- & Wechselmöglichkeiten:
  1. Manuelle / Pneumatische Wechselvorrichtung: Spannkopfwechsel in UNTER 8–10 SEKUNDEN ohne Werkzeug/Futterdemontage.
  2. MANDO Adapt Dorn-Einwechselsystem: Verwandelt das vorhandene Futter (SPANNTOP/TOPlus) in unter 1 Minute über eine Zentralschraube in einen hochpräzisen Spanndorn mit axialem Niederzug.
  3. centroteX Schnellwechselsystem: Kompletter Futterwechsel (Spannfutter zu Backenfutter oder Magnetplatte) in unter 1 Minute mit < 0,002 mm Rundlaufgenauigkeit über eine einzige Schraube ohne Ausrichten!

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
  if (res.writableEnded || res.destroyed) return;
  try {
    res.write(JSON.stringify(obj) + "\n");
  } catch { /* client gone */ }
}

// ── P2 helpers: LLM health (cached), IP hashing, log redaction ────────
const LLM_BASE = LLM_URL.replace(/\/chat\/completions\/?$/, "");
let llmHealth = { ok: false, at: 0 };
async function checkLlm() {
  if (Date.now() - llmHealth.at < 30000) return llmHealth.ok;
  try {
    const r = await fetch(`${LLM_BASE}/models`, { signal: AbortSignal.timeout(2500) });
    llmHealth = { ok: r.ok, at: Date.now() };
  } catch {
    llmHealth = { ok: false, at: Date.now() };
  }
  return llmHealth.ok;
}
function hashIp(ip) {
  try {
    return crypto.createHash("sha256").update(String(ip || "local")).digest("hex").slice(0, 12);
  } catch {
    return "unknown";
  }
}
// Strip base64 image payloads before logging (disk bloat + PII).
function redactMessages(msgs) {
  return (msgs || []).map((m) => {
    if (typeof m.content === "string") return { role: m.role, content: m.content.slice(0, 20000) };
    if (Array.isArray(m.content)) {
      return {
        role: m.role,
        content: m.content.map((c) =>
          c.type === "image_url" ? { type: "image_url", image_url: "[omitted]" } : c
        ),
      };
    }
    return { role: m.role, content: "" };
  });
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
  // Auto-correct and guarantee exact hero images for every HAINBUCH solution.
  // NOTE: [^#]*? instead of [\s\S]*? so a replacement never crosses into the
  // next ### section and rewrites another product's image.
  s = s.replace(/(###[^#\n]*SPANNTOP\s+nova[^#\n]*\n[^#]*?)!\[([^\]]*)\]\([^)]+\)/gi, `$1![$2](${BASE_URL}/hero-img/hero_94.jpg)`);
  s = s.replace(/(###[^#\n]*SPANNTOP\s+mini[^#\n]*\n[^#]*?)!\[([^\]]*)\]\([^)]+\)/gi, `$1![$2](${BASE_URL}/hero-img/hero_74.jpg)`);
  s = s.replace(/(###[^#\n]*TOPlus\s+mini[^#\n]*\n[^#]*?)!\[([^\]]*)\]\([^)]+\)/gi, `$1![$2](${BASE_URL}/hero-img/hero_28.jpg)`);
  s = s.replace(/(###[^#\n]*TOPlus\s+(?:nova|premium|kombi)[^#\n]*\n[^#]*?)!\[([^\]]*)\]\([^)]+\)/gi, `$1![$2](${BASE_URL}/hero-img/hero_60.jpg)`);
  s = s.replace(/(###[^#\n]*InoFlex[^#\n]*\n[^#]*?)!\[([^\]]*)\]\([^)]+\)/gi, `$1![$2](${BASE_URL}/hero-img/hero_136.jpg)`);
  s = s.replace(/(###[^#\n]*MANOK[^#\n]*\n[^#]*?)!\[([^\]]*)\]\([^)]+\)/gi, `$1![$2](${BASE_URL}/hero-img/hero_246.jpg)`);
  s = s.replace(/(###[^#\n]*MANDO\s+T21[12][^#\n]*\n[^#]*?)!\[([^\]]*)\]\([^)]+\)/gi, `$1![$2](${BASE_URL}/hero-img/hero_178.jpg)`);
  s = s.replace(/(###[^#\n]*MANDO\s+Adapt[^#\n]*\n[^#]*?)!\[([^\]]*)\]\([^)]+\)/gi, `$1![$2](${BASE_URL}/hero-img/hero_272.jpg)`);
  s = s.replace(/(###[^#\n]*centroteX[^#\n]*\n[^#]*?)!\[([^\]]*)\]\([^)]+\)/gi, `$1![$2](${BASE_URL}/hero-img/hero_242.jpg)`);
  s = s.replace(/(###[^#\n]*B-Top[^#\n]*\n[^#]*?)!\[([^\]]*)\]\([^)]+\)/gi, `$1![$2](${BASE_URL}/hero-img/hero_146.jpg)`);

  // Sanitize links ONLY in the '## Quellen' section, NEVER touching ![...](...) image tags
  if (s.includes("## Quellen")) {
    const qIdx = s.indexOf("## Quellen");
    const bodyPart = s.slice(0, qIdx);
    let quellenPart = s.slice(qIdx);
    quellenPart = quellenPart.replace(/(?<!!)\[([^\]]+)\]\((https?:\/\/[^\s)]+\.(?:jpg|jpeg|png|gif|webp|svg))\)/gi, '[$1](https://www.hainbuch.com)');
    quellenPart = quellenPart.replace(/(?<!!)\[([^\]]+)\]\((https?:\/\/(?:www\.)?(?:bisspecials|directindustry|traceparts)[^\s)]*)\)/gi, '[$1](https://www.hainbuch.com)');
    s = bodyPart + quellenPart;
  }
  return s;
}

async function handleChat(req, res) {
  let body = "";
  let tooLarge = false;
  req.on("data", (c) => {
    if (tooLarge) return;
    body += c;
    if (body.length > 15 * 1024 * 1024) {
      tooLarge = true;
      try { res.writeHead(413, { "Content-Type": "application/json" }); } catch {}
      try { res.end(JSON.stringify({ error: "payload too large" })); } catch {}
      try { req.destroy(); } catch {}
    }
  });
  req.on("end", async () => {
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Accel-Buffering", "no");

    let messages;
    let parsed;
    try {
      parsed = JSON.parse(body);
      if (!Array.isArray(parsed.messages) || parsed.messages.length === 0) throw new Error();
      messages = parsed.messages.slice(-20).map((m) => {
        const role = m.role === "model" ? "assistant" : m.role === "system" ? "user" : m.role;
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
              image_url: { url: `data:${p.inlineData.mimeType};base64,${String(p.inlineData.data || "").slice(0, 5 * 1024 * 1024)}` },
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
          `- ${p.title} | Mat-Nr: ${p.materialNo || "—"} | Größe: ${p.size || "—"}${p.clampDiaMm ? " | Spann-Ø: " + p.clampDiaMm + " mm" : ""}${p.fits ? " | Passend für: " + p.fits.replace(/\n/g, ", ") : ""}${p.image ? ` | Foto: ![${p.title}](${BASE_URL}/shop-img/${p.image})` : ""}`
      );
      shopContext = `\n\nKONKRETE HAINBUCH-SHOP-PRODUKTE MIT MAT-NUMMERN & FOTO ZU DIESER ANFRAGE (übernimm diese realen Artikelnummern in Stücklisten und Einrichteblatt):\n${lines.join("\n")}`;
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
    const machine = parsed?.machine;
    let machineContext = "";
    if (machine && machine.name) {
      machineContext = `\n\nKUNDEN-MASCHINENPROFIL:\n- Ausgewählte Maschine: ${machine.name}\n- Spindelschnittstelle: ${machine.spindle || "Standard"}\n- CNC-Steuerung & G-Code Format: ${machine.control || "Siemens Sinumerik / ISO"}\n${machine.drawtube ? "- Zugrohranbindung: " + machine.drawtube + "\n" : ""}${machine.table ? "- Maschinentisch: " + machine.table + "\n" : ""}WICHTIG: Nutze diese Spindelschnittstelle für die Flansch- und Einrichteblatt-Auslegung und formatiere eventuelle CNC-Programm-Zyklen exakt für die angegebene Steuerung (${machine.control || "Siemens / ISO"})!\n`;
    }
    const goldContext = retrieveGoldStandards(combinedQuery);
    // Backward compat: older frontends send lastAnalysis for follow-ups.
    // New frontend omits it to save bytes; if present, reuse as extra context.
    const prevPlan = parsed?.lastAnalysis;
    let followupContext = "";
    if (prevPlan && typeof prevPlan === "object") {
      try {
        const s = JSON.stringify(prevPlan).slice(0, 2000);
        if (s.length > 20) followupContext = `\n\nVORHERIGER ARBEITSPLAN (Folgefrage bezieht sich ggf. darauf):\n${s}`;
      } catch {}
    }
    const startTime = Date.now();
    const heartbeat = setInterval(() => emit(res, { type: "ping" }), 15000);
    // Client gone (tab closed, tunnel dropped) -> abort in-flight LLM calls
    // instead of burning 2x Gemini on an answer nobody receives.
    // IMPORTANT: use res 'close', not req 'close'. The request stream closes
    // as soon as the POST body is fully read, which would abort the pipeline
    // mid-LLM even while the response socket is still open.
    const aborter = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) aborter.abort();
    });
    const llmSignal = () => AbortSignal.any([AbortSignal.timeout(600000), aborter.signal]);
    const hasImagesEarly = messages.some((m) => Array.isArray(m.content) && m.content.some((c) => c.type === "image_url"));
    // Fast-path for smalltalk ("Hey", "Danke", ...): one cheap call, no RAG,
    // no google_search tool, no QA pass. Previously even "Hey" cost ~7s + 2x LLM.
    const isSmalltalk = (() => {
      if (hasImagesEarly) return false;
      const q = (questionText || "").trim();
      if (!q || q.length > 40) return false;
      if (/\d/.test(q)) return false;
      if (/[Øø]|\bmm\b|\bµm\b|\bISO\b|\bH7\b|\bh6\b|\bk6\b|spann|futter|mando|toplus|manok|inoflex|centrotex|dreh|fräs|bohr|reib|werkst|passung|schnitt|maschine/i.test(q)) return false;
      return /^(hi|hey|hello|hallo|guten\s*(tag|morgen|abend)?|moin|servus|grüezi|danke|thanks?|bitte|ok|okay|ja|nein|tschüss|bye|ciao)\b[.!?\s]*$/i.test(q);
    })();
    try {
      if (isSmalltalk) {
        emit(res, { type: "status", stage: "chat", label: "Einen Moment…" });
        const small = await fetch(LLM_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: MODEL_ID,
            messages: [
              { role: "system", content: "Du bist der HAINBUCH Technical Advisor. Antworte kurz und freundlich auf Deutsch (1-2 Sätze): begrüße, stelle dich als Spanntechnik-Berater vor und bitte um Werkstückdaten / Zeichnung / Toleranzen. Keine Arbeitspläne, keine Tabellen, keine Quellen." },
              ...messages.slice(-4),
            ],
          }),
          signal: llmSignal(),
        });
        const sj = await small.json();
        const sText = cleanLaTeX(sj.choices?.[0]?.message?.content ?? "Hallo! Ich bin der HAINBUCH Technical Advisor für Spanntechnik. Beschreiben Sie gern Ihr Werkstück oder laden Sie eine Zeichnung hoch!");
        logChatInteraction({
          ipHash: hashIp(clientIp(req)),
          country: req.headers["cf-ipcountry"] || null,
          messages: redactMessages(messages),
          question: questionText,
          response: sText,
          imagesCited: [],
          durationMs: Date.now() - startTime,
          stage: "success",
          fastPath: true,
        });
        const convIdFast = await persistChatTurn(req, parsed, questionText, sText, Date.now() - startTime);
        emit(res, { type: "result", data: { message: sText, conversationId: convIdFast } });
        return;
      }
      const hasImages = messages.some((m) => Array.isArray(m.content) && m.content.some((c) => c.type === "image_url"));
      const tools = hasImages ? undefined : [{ google_search: {} }];

      emit(res, { type: "status", stage: "chat", label: hasImages ? "Zeichnung / Bild wird analysiert…" : "HAINBUCH-Wissen wird durchsucht…" });
      const upstream = await fetch(LLM_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL_ID,
          messages: [
            { role: "system", content: SYSTEM_PROMPT + machineContext + goldContext + followupContext + fitsContext + catalogContext + shopContext + context },
            ...messages,
          ],
          ...(tools ? { tools } : {}),
        }),
        signal: llmSignal(),
      });
      const json = await upstream.json();
      const answer =
        cleanLaTeX(
          json.choices?.[0]?.message?.content ??
            "Es ist ein Fehler bei der Modellabfrage aufgetreten. Bitte versuche es erneut."
        );

    emit(res, { type: "status", stage: "chat", label: "Qualitätsprüfung der Auslegung…" });
    let finalAnswer = answer;
    // 2-Stufen-System: Der 2. Schritt (QA-Prüfung) wird für jeden Arbeitsplan, jede Auslegung und Zeichnungsanalyse zwingend ausgeführt!
    const needsQa = answer.length > 400 && (
      answer.includes("OP 10") ||
      answer.includes("OP 20") ||
      answer.includes("Arbeitsplan") ||
      answer.includes("Spannmittel") ||
      answer.includes("Abstechen") ||
      answer.includes("Reiben") ||
      answer.includes("Bohrstange") ||
      answer.includes("Lösung") ||
      hasImages ||
      answer.length > 1500
    );
    if (needsQa) {
    try {
      const qa = await fetch(LLM_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL_ID,
          messages: [
            { role: "system", content: "Du bist ein strenger QA-Prüfer für HAINBUCH-Auslegungen. Prüfe den Entwurf gegen diese Checkliste und korrigiere alle Mängel direkt:\n0) STRIKTER 2-STUFIGER ABLAUF (PFLICHT):\n- STUFE 1 (Erstkontakt / Bestand unklar): Wenn der Nutzer das Werkstück neu beschreibt und noch KEIN Futter genannt hat und noch NICHT nach Optionen gefragt hat: Der Entwurf MUSS kurz sein (1-2 Sätze technische Einleitung/Passungen) und ZWINGEND mit der Bestandsfrage enden: 'Haben Sie bereits ein Spannfutter bzw. HAINBUCH-Spannmittel in Ihrer Fertigung (z. B. SPANNTOP, TOPlus, MANDO, InoFlex, B-Top, MANOK) – oder soll ich Ihnen passende Optionen vorschlagen?'. Falls der Entwurf fälschlicherweise schon den vollen Arbeitsplan enthält, KÜRZE ihn und füge die Bestandsfrage ein! (WICHTIGE AUSNAHME: Wenn eine technische Zeichnung oder ein Werkstückbild hochgeladen wurde, MUSS die Zeichnung IMMER vollständig ausgewertet werden mit Maßen, Passungen, Werkstoff und passenden HAINBUCH-Spannmitteln!)\n- STUFE 2 (Nach Kundenantwort): Wenn der Kunde sein Futter nennt (z. B. 'habe SPANNTOP nova'), MUSS die Auslegung zu 100% auf dieses Futter angepasst sein (Spannköpfe, Dorn-Adaption MANDO Adapt, Arbeitsplan, Werkzeuge)! Wenn der Kunde kein Futter hat / nach Optionen fragt ('schlag mir vor'), MUSS die vollständige Auslegung mit 3-5 Lösungen, Arbeitsplan, Schnittdaten, ISO-Zeiten, Werkzeugen, Anti-Polygon-Check, ROI und Fotos enthalten sein!\n1) ECHTE und PASSENDE Markdown-Fotos ![Name](URL) (InoFlex -> hero_136.jpg / hero_262.jpg, B-Top -> hero_146.jpg / hero_150.jpg, centroteX -> hero_242.jpg, MANOK plus -> hero_246.jpg, MANOK -> hero_242.jpg, MANDO -> hero_178.jpg, MANDO Adapt -> hero_272.jpg, SPANNTOP nova -> hero_94.jpg, SPANNTOP mini -> hero_74.jpg; NIEMALS falsche Bilder wie Kran für InoFlex oder Messkoffer für Spannfutter kopieren!).\n2) Tabellen max. 5 Spalten, Lösungen als Zeilen.\n3) KEIN LaTeX, keine $-Zeichen; Formeln im Klartext (z. B. t_h = L / vf); deutsche Komma-Dezimalzahlen.\n4) Passungswerte aus dem VORBEBERECHNETEN Block 1:1 übernehmen; alle Rechnungen nachprüfen und Fehler korrigieren.\n5) Abschließend Sektion '## Quellen' mit klickbaren [Titel](URL)-Links (min. 2).\n6) LÄNGEN- & ABSTICH-KONSISTENZ: Prüfe peinlich genau die Gesamtlänge des Werkstücks! Wenn das Teil z. B. Hülse 75 mm + Zapfen 25 mm hat (Gesamtlänge 100 mm), darf in OP 10 NIEMALS auf 76 mm abgestochen werden! Die Abstichlänge MUSS mindestens die Gesamtlänge + Aufmaß sein (z. B. Abstechen auf 102–103 mm). Korrigiere fehlerhafte Abstichlängen im Arbeitsplan sofort!\n7) REIBEN vs. FEINDREHEN: Bei Sacklochbohrungen mit Radius (z. B. R0,3) oder flachem Grund darf KEINE Reibahle verwendet werden (Anschnittkollision). Ersetze Reibahle durch Feindreh-Bohrstange!\n8) ISO 1101 FORM-TOLERANZEN: Reine Formtoleranzen (Rundheit, Zylindrizität, Geradheit, Ebenheit) dürfen laut ISO 1101 NIEMALS ein Bezugselement (z. B. | A) besitzen. Entferne unzulässige Bezüge bei Formtoleranzen!\nAntworte NUR mit der vollständigen korrigierten finalen Antwort – kein Kommentar, keine Begründung der Änderungen." },
            { role: "user", content: `NUTZERFRAGE:\n${questionText}\n\nVORBEBERECHNETE PASSUNGEN:\n${precomputed || "—"}\n\nKATALOG-KONTEXT:\n${catalogContext || "—"}\n\nSHOP-KONTEXT:\n${shopContext || "—"}\n\nENTWURF ZU PRÜFEN:\n${answer}` },
          ],
          ...(tools ? { tools } : {}),
        }),
        signal: llmSignal(),
      });
      const qj = await qa.json();
      const fixed = qj.choices?.[0]?.message?.content;
      if (fixed && fixed.length > 500) finalAnswer = fixed;
    } catch {}
    } // end needsQa
    const cleaned = cleanLaTeX(finalAnswer);
    const imagesCited = (cleaned.match(/!\[[^\]]*\]\(([^)]+)\)/g) || []);
    logChatInteraction({
      ipHash: hashIp(clientIp(req)),
      country: req.headers["cf-ipcountry"] || null,
      messages: redactMessages(messages),
      question: questionText,
      response: cleaned,
      imagesCited,
      durationMs: Date.now() - startTime,
      stage: "success",
    });
    const convId = await persistChatTurn(req, parsed, questionText, cleaned, Date.now() - startTime);
    emit(res, { type: "result", data: { message: cleaned, conversationId: convId } });
    } catch (e) {
      const aborted = aborter.signal.aborted;
      if (!aborted) {
        logChatInteraction({
          ipHash: hashIp(clientIp(req)),
          country: req.headers["cf-ipcountry"] || null,
          messages: redactMessages(messages),
          question: questionText,
          error: String(e.message || "LLM-Fehler").slice(0, 300),
          durationMs: Date.now() - startTime,
          stage: "error",
        });
        emit(res, { type: "error", error: "LLM-Fehler — bitte erneut versuchen." });
      }
    } finally {
      clearInterval(heartbeat);
      try { res.end(); } catch {}
    }
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-app-key, x-admin-key, x-request-id, Authorization, x-user-email, x-ui-lang");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }
  if (req.method === "GET" && (req.url === "/api/status" || req.url === "/health")) {
    const llmOnline = req.url === "/health" ? true : await checkLlm();
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({
      model: MODEL_ID,
      llmOnline,
      mode: "hainbuch-gemini-only",
      kb: KB.length,
      catalog: CATALOG.length,
      history: !!(histDb && histDb.ok()),
      authMode: histAuth ? histAuth.mode() : "none",
      country: typeof req.headers["cf-ipcountry"] === "string"
        ? req.headers["cf-ipcountry"].toUpperCase()
        : null,
    }));
  }
  const rawUrl = (req.url || "").split("?")[0];
  if ((req.method === "GET" || req.method === "HEAD") && (rawUrl.startsWith("/hero-img/") || rawUrl.startsWith("/shop-img/"))) {
    let file;
    try {
      file = path.basename(decodeURIComponent(rawUrl.replace(/^\/(hero-img|shop-img)\//, '')));
    } catch {
      res.writeHead(400);
      return res.end();
    }
    if (file.includes("..") || file.includes("/") || file.includes("\\")) {
      res.writeHead(400);
      return res.end();
    }
    const heroFull = path.join(HERO_DIR, file);
    const shopFull = path.join(SHOP_DIR, file);
    const resolved = fs.existsSync(heroFull) ? heroFull : (fs.existsSync(shopFull) ? shopFull : null);
    if (!resolved) {
      res.writeHead(404);
      return res.end();
    }
    const ext = path.extname(resolved).toLowerCase();
    const imgType = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : ext === ".svg" ? "image/svg+xml" : "image/jpeg";
    res.writeHead(200, { "Content-Type": imgType, "Cache-Control": "public, max-age=86400" });
    if (req.method === "HEAD") return res.end();
    const imgStream = fs.createReadStream(resolved);
    imgStream.on("error", () => {
      try { res.writeHead(500); } catch {}
      try { res.end(); } catch {}
    });
    return imgStream.pipe(res);
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
    if (feedbackLimited(req, res)) return;
    let fbBody = "";
    let fbTooLarge = false;
    req.on("data", (c) => {
      if (fbTooLarge) return;
      fbBody += c;
      if (fbBody.length > 256 * 1024) {
        fbTooLarge = true;
        res.writeHead(413, { "Content-Type": "application/json" });
        try { res.end(JSON.stringify({ error: "payload too large" })); } catch {}
        try { req.destroy(); } catch {}
      }
    });
    req.on("end", () => {
      let rating = null, message = "";
      let conversationId = "";
      try { const p = JSON.parse(fbBody || "{}"); rating = p.rating; message = p.message; conversationId = p.conversationId || ""; } catch {}
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
      // Mirror into SQLite for the training loop (best-effort, never blocks).
      try {
        if (histDb && histDb.ok()) {
          const em = histDb.normalizeEmail(req.headers["x-user-email"]);
          const u = em ? (histDb.getUserByEmail(em) || null) : null;
          histDb.saveFeedback({ userId: u ? u.id : "", conversationId: String(conversationId).slice(0, 64), rating, message: entry.message });
        }
      } catch (e) { console.warn("[Feedback] db mirror failed:", e.message); }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }
  if (req.method === "GET" && req.url === "/api/admin") {
    // If ADMIN_KEY is set, it is ALWAYS required — even on loopback.
    // (Cloudflared public traffic arrives via loopback, so loopback alone
    // proves nothing on a tunneled host.)
    if (ADMIN_KEY) {
      if (req.headers["x-admin-key"] !== ADMIN_KEY) {
        res.writeHead(req.headers["x-admin-key"] ? 401 : 403, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "localhost only" }));
      }
    } else if (!isLoopback(req)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "localhost only" }));
    }
    let feedback = [];
    try {
      feedback = fs.readFileSync(path.join(__dirname, "feedback.jsonl"), "utf8").trim().split("\n").slice(-50).map((l) => JSON.parse(l));
    } catch { /* none yet */ }
    res.writeHead(200, { "Content-Type": "application/json" });
    const dbStats = histDb ? histDb.stats() : { disabled: "no module" };
    return res.end(JSON.stringify({ feedback, dayBudget, ratePerHour: RATE_PER_HOUR, ratePerDay: RATE_PER_DAY, rateBucketIps: rateBuckets.size, db: dbStats, authMode: histAuth ? histAuth.mode() : "none" }));
  }
  // ── Training-data export for the model-improvement loop (ADMIN_KEY, like /api/admin) ──
  if (req.method === "GET" && rawUrl === "/api/admin/export") {
    if (ADMIN_KEY) {
      if (req.headers["x-admin-key"] !== ADMIN_KEY) {
        res.writeHead(req.headers["x-admin-key"] ? 401 : 403, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "localhost only" }));
      }
    } else if (!isLoopback(req)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "localhost only" }));
    }
    if (!histDb || !histDb.ok()) {
      res.writeHead(503, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "history db disabled" }));
    }
    const q = new URL(req.url || "/", "http://x").searchParams;
    const data = histDb.exportTrainingData(q.get("since") || "1970-01-01");
    if (q.get("format") === "jsonl") {
      const lines = [];
      for (const m of data.messages) {
        lines.push(JSON.stringify({ type: "message", ...m }));
      }
      for (const f of data.feedback) lines.push(JSON.stringify({ type: "feedback", ...f }));
      res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8" });
      return res.end(lines.join("\n") + (lines.length ? "\n" : ""));
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(data));
  }
  // ── Register / login (Phase 1 email stub; upgrades to Firebase in Phase 2) ──
  if (req.method === "POST" && rawUrl === "/api/auth/sync") {
    if (APP_KEY && req.headers["x-app-key"] !== APP_KEY) {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "unauthorized" }));
    }
    const p = await readJsonBody(req);
    if (p.__tooLarge || p.__invalid || !histDb || !histDb.ok()) {
      res.writeHead(p.__tooLarge ? 413 : 503, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: p.__tooLarge ? "payload too large" : "history db disabled" }));
    }
    const email = histDb.normalizeEmail(p.email);
    if (!email) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "valid email required" }));
    }
    const prev = histDb.getUserByEmail(email);
    // Login tab: unknown e-mail is NOT auto-created — tell the client to register.
    if (p.loginOnly && !prev) {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "not-registered" }));
    }
    const userId = prev ? prev.id : (histDb.upsertUser({
      email,
      displayName: String(p.displayName || "").slice(0, 80),
      country: String(p.country || req.headers["cf-ipcountry"] || "").slice(0, 4),
      uiLang: String(p.uiLang || req.headers["x-ui-lang"] || "").slice(0, 8),
      consentTerms: !!p.consentTerms,
      consentMarketing: !!p.consentMarketing,
    }) || {}).id;
    const token = userId ? histDb.createSession(userId) : null;
    const user = histDb.getUserByEmail(email);
    if (!token || !user) {
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "sync failed" }));
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({
      ok: true, token,
      user: { id: user.id, email: user.email, displayName: user.display_name, country: user.country_code, uiLang: user.ui_lang },
    }));
  }
  // ── Conversation history (login via Bearer token or x-user-email) ──
  const resolveHistoryUser = async () => {
    if (!histDb || !histDb.ok()) return { err: "history db disabled" };
    const auth = histAuth ? await histAuth.getAuth(req).catch(() => null) : null;
    let user = auth && auth.uid ? histDb.getUserById(auth.uid) : null;
    const email = histDb.normalizeEmail((auth && auth.email) || req.headers["x-user-email"]);
    if (!user && email) user = histDb.getUserByEmail(email) || histDb.upsertUser({ email });
    if (!user) return { err: "login required" };
    return { user };
  };
  if (rawUrl === "/api/history" && (req.method === "GET" || req.method === "POST")) {
    if (APP_KEY && req.headers["x-app-key"] !== APP_KEY) {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "unauthorized" }));
    }
    const { user, err } = await resolveHistoryUser();
    if (err) {
      res.writeHead(err === "login required" ? 401 : 503, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: err }));
    }
    if (req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ conversations: histDb.listConversations(user.id) }));
    }
    const p = await readJsonBody(req);
    if (p.__tooLarge || p.__invalid) {
      res.writeHead(p.__tooLarge ? 413 : 400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "invalid body" }));
    }
    const conv = histDb.createConversation({
      userId: user.id,
      title: String(p.title || "Neue Beratung").slice(0, 120),
      country: String(p.country || user.country_code || "").slice(0, 4),
      uiLang: String(p.uiLang || user.ui_lang || "").slice(0, 8),
      machine: p.machine,
    });
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ conversation: conv }));
  }
  if (rawUrl.startsWith("/api/history/") && (req.method === "GET" || req.method === "PUT" || req.method === "DELETE")) {
    if (APP_KEY && req.headers["x-app-key"] !== APP_KEY) {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "unauthorized" }));
    }
    const { user, err } = await resolveHistoryUser();
    if (err) {
      res.writeHead(err === "login required" ? 401 : 503, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: err }));
    }
    const id = decodeURIComponent(rawUrl.slice("/api/history/".length)).split("/")[0].slice(0, 64);
    if (req.method === "GET") {
      const conv = histDb.getConversation(id, user.id);
      if (!conv) {
        res.writeHead(404, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "not found" }));
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ conversation: conv }));
    }
    if (req.method === "DELETE") {
      const okDel = histDb.deleteConversation(id, user.id);
      res.writeHead(okDel ? 200 : 404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(okDel ? { ok: true } : { error: "not found" }));
    }
    const p = await readJsonBody(req);
    if (p.__tooLarge || p.__invalid) {
      res.writeHead(p.__tooLarge ? 413 : 400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "invalid body" }));
    }
    const okRen = histDb.renameConversation(id, user.id, p.title);
    res.writeHead(okRen ? 200 : 404, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(okRen ? { ok: true } : { error: "not found" }));
  }

  // Statische Auslieferung der gebauten UI (dist/) + SPA-Fallback
  // Containment: never serve outside dist/ (blocks /../.app_key etc.).
  // Unknown /api/* returns JSON 404 instead of index.html.
  if (req.method === "GET") {
    let urlPath;
    try {
      urlPath = decodeURIComponent(req.url.split("?")[0]);
    } catch {
      res.writeHead(400);
      return res.end();
    }
    if (urlPath.startsWith("/api/")) {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "not found" }));
    }
    const distDir = path.join(__dirname, "dist");
    const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
    const full = path.normalize(path.join(distDir, rel));
    if (full !== distDir && !full.startsWith(distDir + path.sep)) {
      res.writeHead(403);
      return res.end();
    }
    const candidates = fs.existsSync(full) && fs.statSync(full).isFile()
      ? [full]
      : [path.join(distDir, "index.html")];
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
      const stream = fs.createReadStream(file);
      stream.on("error", () => {
        try { res.writeHead(500); } catch {}
        try { res.end(); } catch {}
      });
      return stream.pipe(res);
    }
  }
  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(`HAINBUCH Gemini-only API auf http://localhost:${PORT}`);
  if (!process.env.BASE_URL) {
    console.warn("[Config] BASE_URL not set — photo URLs fall back to localhost and will be broken on the live site. Set BASE_URL=https://<tunnel-url>");
  }
  if (!APP_KEY) console.warn("[Config] APP_KEY not set — /api/chat + /api/feedback are open.");
  if (!ADMIN_KEY) console.warn("[Config] ADMIN_KEY not set — /api/admin allows loopback without key.");
});
