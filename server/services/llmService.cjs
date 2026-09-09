// LLM Gateway and interaction service
const fs = require("fs");
const path = require("path");
const {
  LLM_URL,
  MODEL_ID,
  MODEL_QA,
  ROOT_DIR,
  BASE_URL,
} = require("../config.cjs");

let histDb = null;
try { histDb = require("../../lib/db.cjs"); } catch {}

const LLM_URLS = (process.env.LLM_URLS || LLM_URL).split(",").map((s) => s.trim()).filter(Boolean);
const MODEL_FALLBACK = process.env.MODEL_FALLBACK || "gemini-3.1-flash-lite";

function statLlm(kind, model, ms, usage, error) {
  try {
    if (histDb && histDb.recordLlmStat) histDb.recordLlmStat({ kind, model, ms, usage, error });
  } catch {}
}

async function llmFetch(payload, signal, kind) {
  const models = [payload.model || MODEL_ID];
  if (MODEL_FALLBACK && !models.includes(MODEL_FALLBACK)) models.push(MODEL_FALLBACK);
  let lastErr = null;
  for (const m of models) {
    for (const u of LLM_URLS) {
      for (let t = 0; t < 2; t++) {
        const started = Date.now();
        try {
          const r = await fetch(u, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...payload, model: m }),
            signal,
          });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const j = await r.json();
          statLlm(kind, m, Date.now() - started, j.usage, null);
          return { res: j, model: m };
        } catch (e) {
          lastErr = e;
          statLlm(kind, m, Date.now() - started, null, String((e && e.message) || e).slice(0, 120));
          if (e && e.name === "AbortError") throw e;
          await new Promise((r) => setTimeout(r, 400 * (t + 1)));
        }
      }
    }
  }
  throw lastErr;
}

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

const LOGS_DIR = path.join(ROOT_DIR, "logs");
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

function redactMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages.map((m) => {
    if (!m) return { role: "user", content: "" };
    if (typeof m.content === "string") return { role: m.role, content: m.content.slice(0, 1500) };
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

function cleanLaTeX(t, baseUrl = BASE_URL) {
  let s = t || "";
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

  s = s.replace(/(###[^#\n]*SPANNTOP\s+nova[^#\n]*\n[^#]*?)!\[([^\]]*)\]\([^)]+\)/gi, `$1![$2](${baseUrl}/hero-img/hero_94.jpg)`);
  s = s.replace(/(###[^#\n]*SPANNTOP\s+mini[^#\n]*\n[^#]*?)!\[([^\]]*)\]\([^)]+\)/gi, `$1![$2](${baseUrl}/hero-img/hero_74.jpg)`);
  s = s.replace(/(###[^#\n]*TOPlus\s+mini[^#\n]*\n[^#]*?)!\[([^\]]*)\]\([^)]+\)/gi, `$1![$2](${baseUrl}/hero-img/hero_28.jpg)`);
  s = s.replace(/(###[^#\n]*TOPlus\s+(?:nova|premium|kombi)[^#\n]*\n[^#]*?)!\[([^\]]*)\]\([^)]+\)/gi, `$1![$2](${baseUrl}/hero-img/hero_60.jpg)`);
  s = s.replace(/(###[^#\n]*InoFlex[^#\n]*\n[^#]*?)!\[([^\]]*)\]\([^)]+\)/gi, `$1![$2](${baseUrl}/hero-img/hero_136.jpg)`);
  s = s.replace(/(###[^#\n]*MANOK[^#\n]*\n[^#]*?)!\[([^\]]*)\]\([^)]+\)/gi, `$1![$2](${baseUrl}/hero-img/hero_246.jpg)`);
  s = s.replace(/(###[^#\n]*MANDO\s+T21[12][^#\n]*\n[^#]*?)!\[([^\]]*)\]\([^)]+\)/gi, `$1![$2](${baseUrl}/hero-img/hero_178.jpg)`);
  s = s.replace(/(###[^#\n]*MANDO\s+Adapt[^#\n]*\n[^#]*?)!\[([^\]]*)\]\([^)]+\)/gi, `$1![$2](${baseUrl}/hero-img/hero_272.jpg)`);
  s = s.replace(/(###[^#\n]*centroteX[^#\n]*\n[^#]*?)!\[([^\]]*)\]\([^)]+\)/gi, `$1![$2](${baseUrl}/hero-img/hero_242.jpg)`);
  s = s.replace(/(###[^#\n]*B-Top[^#\n]*\n[^#]*?)!\[([^\]]*)\]\([^)]+\)/gi, `$1![$2](${baseUrl}/hero-img/hero_146.jpg)`);

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

module.exports = {
  MODEL_ID,
  MODEL_QA,
  MODEL_FALLBACK,
  llmFetch,
  checkLlm,
  cleanLaTeX,
  redactMessages,
  readJsonBody,
  logChatInteraction,
};
