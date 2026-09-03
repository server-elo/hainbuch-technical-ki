#!/usr/bin/env node
// Pull the training-data export from the running backend, merge the (much
// richer) anonymous jsonl chat logs, SANITIZE everything, and store it under
// data/training/. Needs ADMIN_KEY (+ APP_KEY if set).
//
// Sanitizing (why: this file may be shared / used for fine-tuning):
// - ids (message/conversation/user) -> per-run salted hashes (joins stay
//   intact WITHIN one file, unlinkable ACROSS files)
// - photo hosts (localhost, rotated trycloudflare tunnels) -> __BACKEND__
//   placeholder (trains structure, not dead hosts)
// - base64 image payloads -> dropped (filenames/dimensions kept)
// - e-mails / display names are never exported (DB users table is excluded;
//   only pseudonymous chat rows are used)
// Known limitation: free-text may contain user-pasted PII (names, order
// numbers) — the manual review step in TRAINING.md stays mandatory.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const BASE = process.env.TRAIN_BASE || "http://localhost:3002";
const ADMIN_KEY = process.env.ADMIN_KEY || fs.existsSync(path.join(__dirname, "..", ".admin_key"))
  ? String(fs.readFileSync(path.join(__dirname, "..", ".admin_key"), "utf8")).trim()
  : "";
const APP_KEY = process.env.APP_KEY || (fs.existsSync(path.join(__dirname, "..", ".app_key"))
  ? String(fs.readFileSync(path.join(__dirname, "..", ".app_key"), "utf8")).trim()
  : "");
const SINCE = process.argv[2] || "1970-01-01";
const sinceMs = Date.parse(SINCE + "T00:00:00Z") || 0;

const SALT = crypto.randomBytes(8).toString("hex");
const hid = (v) => (v ? crypto.createHash("sha256").update(SALT + String(v)).digest("hex").slice(0, 16) : "");
const cleanHosts = (s) => String(s || "")
  .replace(/http:\/\/localhost:\d+/g, "__BACKEND__")
  .replace(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g, "__BACKEND__");
const stripB64 = (s) => String(s || "").replace(/data:image\/[a-zA-Z+.-]+;base64,[A-Za-z0-9+/=]+/g, "[image-payload-removed]");

function sanitizeMessage(m) {
  return {
    type: "message",
    id: hid(m.id),
    conversation_id: hid(m.conversation_id),
    role: m.role,
    content: cleanHosts(stripB64(m.content)).slice(0, 60000),
    images_meta: stripB64(m.images_meta || "").slice(0, 2000),
    analysis: stripB64(m.analysis || "").slice(0, 2000),
    model: m.model || "",
    duration_ms: m.duration_ms || 0,
    created_at: m.created_at || "",
  };
}

function sanitizeFeedback(f) {
  return {
    type: "feedback",
    id: hid(f.id),
    user_id: hid(f.user_id),
    conversation_id: hid(f.conversation_id),
    rating: f.rating,
    message: cleanHosts(stripB64(f.message || "")).slice(0, 2000),
    created_at: f.created_at || "",
  };
}

function sanitizeChatLog(e) {
  // Anonymous jsonl turn from logChatInteraction(): keep the learnable
  // parts, hash the ip, drop nothing else (content length capped).
  const ts = Date.parse(e.recordedAt || e.ts || "") || 0;
  if (ts < sinceMs) return null;
  const messages = Array.isArray(e.messages) ? e.messages.map((m) => ({
    role: m.role,
    content: cleanHosts(stripB64(typeof m.content === "string" ? m.content : JSON.stringify(m.content || ""))).slice(0, 20000),
  })) : [];
  return {
    type: "chat",
    question: cleanHosts(stripB64(e.question || "")).slice(0, 20000),
    response: cleanHosts(stripB64(e.response || e.error || "")).slice(0, 60000),
    messages: messages.slice(-10),
    imagesCited: Array.isArray(e.imagesCited) ? e.imagesCited.map(cleanHosts).slice(0, 10) : [],
    durationMs: e.durationMs || 0,
    stage: e.stage || "",
    fastPath: !!e.fastPath,
    day: (e.recordedAt || "").slice(0, 10),
  };
}

(async () => {
  const outDir = path.join(__dirname, "..", "data", "training");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const url = `${BASE}/api/admin/export?since=${encodeURIComponent(SINCE)}&format=jsonl`;
  const r = await fetch(url, {
    headers: {
      ...(APP_KEY ? { "x-app-key": APP_KEY } : {}),
      ...(ADMIN_KEY ? { "x-admin-key": ADMIN_KEY } : {}),
    },
  });
  if (!r.ok) {
    console.error(`export failed: HTTP ${r.status} — is the backend running with ADMIN_KEY set?`);
    process.exit(1);
  }
  const out = [];
  let nMsg = 0, nFb = 0, nChat = 0;
  for (const line of (await r.text()).split("\n").filter(Boolean)) {
    try {
      const o = JSON.parse(line);
      if (o.type === "message") { out.push(JSON.stringify(sanitizeMessage(o))); nMsg++; }
      else if (o.type === "feedback") { out.push(JSON.stringify(sanitizeFeedback(o))); nFb++; }
    } catch { /* skip malformed */ }
  }
  // Anonymous jsonl logs: the monolith + its rotations (daily/ duplicates them).
  const logsDir = path.join(__dirname, "..", "logs");
  const logFiles = fs.existsSync(logsDir)
    ? fs.readdirSync(logsDir).filter((f) => f === "chats.jsonl" || /^chats-.*\.jsonl$/.test(f))
    : [];
  for (const f of logFiles) {
    let n = 0;
    for (const line of fs.readFileSync(path.join(logsDir, f), "utf8").split("\n").filter(Boolean)) {
      try {
        const s = sanitizeChatLog(JSON.parse(line));
        if (s) { out.push(JSON.stringify(s)); n++; }
      } catch { /* skip malformed */ }
    }
    nChat += n;
  }
  const dest = path.join(outDir, `export-${stamp}.jsonl`);
  fs.writeFileSync(dest, out.join("\n") + (out.length ? "\n" : ""));
  console.log(`wrote ${dest} — ${nMsg} messages, ${nFb} feedback, ${nChat} anon chats (sanitized, salt ${SALT.slice(0, 8)}…)`);
  console.log("next: review lines, promote the best answers into data/gold_standards.json (see TRAINING.md)");
})().catch((e) => { console.error("export error:", e.message); process.exit(1); });
