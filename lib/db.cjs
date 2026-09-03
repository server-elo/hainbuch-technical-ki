// Persistent storage for users, conversations, messages, feedback.
// Uses built-in node:sqlite (no native deps). All failures are contained:
// if the DB can't open, exports return { disabled: true } and the chat
// pipeline keeps working on jsonl logs alone.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_PATH = process.env.APP_DB_PATH || path.join(DATA_DIR, "app.db");

let db = null;
let disabledReason = null;

function open() {
  if (db || disabledReason) return db;
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    const { DatabaseSync } = require("node:sqlite");
    db = new DatabaseSync(DB_PATH);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE,
        display_name TEXT DEFAULT '',
        country_code TEXT DEFAULT '',
        ui_lang TEXT DEFAULT '',
        consent_terms_at TEXT DEFAULT '',
        consent_marketing INTEGER DEFAULT 0,
        password_hash TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now')),
        last_seen TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        user_id TEXT DEFAULT '',
        title TEXT DEFAULT '',
        country_code TEXT DEFAULT '',
        ui_lang TEXT DEFAULT '',
        machine_profile TEXT DEFAULT '',
        message_count INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        deleted_at TEXT DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_conv_user ON conversations(user_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT DEFAULT '',
        images_meta TEXT DEFAULT '',
        analysis TEXT DEFAULT '',
        model TEXT DEFAULT '',
        duration_ms INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, created_at);
      CREATE TABLE IF NOT EXISTS llm_stats (
        day TEXT NOT NULL,
        kind TEXT NOT NULL,
        model TEXT NOT NULL,
        calls INTEGER DEFAULT 0,
        errors INTEGER DEFAULT 0,
        in_tokens INTEGER DEFAULT 0,
        out_tokens INTEGER DEFAULT 0,
        latency_ms INTEGER DEFAULT 0,
        PRIMARY KEY (day, kind, model)
      );
      CREATE TABLE IF NOT EXISTS feedback_db (
        id TEXT PRIMARY KEY,
        user_id TEXT DEFAULT '',
        conversation_id TEXT DEFAULT '',
        rating TEXT DEFAULT '',
        message TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );
    `);
    try {
      db.exec("ALTER TABLE users ADD COLUMN password_hash TEXT DEFAULT '';");
    } catch { /* column already exists */ }
  } catch (e) {
    disabledReason = String(e && e.message || e);
    db = null;
    console.warn("[db] disabled:", disabledReason);
  }
  return db;
}

function ok() {
  return !!open();
}

function uid(prefix) {
  return `${prefix}_${crypto.randomBytes(9).toString("hex")}`;
}

function normalizeEmail(e) {
  const s = String(e || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) return "";
  return s.slice(0, 160);
}

function hashPassword(password) {
  if (!password || typeof password !== "string") return "";
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof stored !== "string" || !stored.includes(":")) return false;
  try {
    const [salt, hash] = stored.split(":");
    const testHash = crypto.scryptSync(password, salt, 64).toString("hex");
    return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(testHash, "hex"));
  } catch {
    return false;
  }
}

function upsertUser({ id, email, displayName, country, uiLang, consentTerms, consentMarketing, password }) {
  const d = open();
  if (!d) return null;
  const now = new Date().toISOString();
  email = normalizeEmail(email);
  let userId = id || "";
  if (!userId && email) {
    const row = d.prepare("SELECT id FROM users WHERE email = ?").get(email);
    if (row) userId = row.id;
  }
  if (!userId) userId = uid("u");
  const prev = d.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  const pwdHash = password ? hashPassword(password) : "";
  if (prev) {
    d.prepare(`UPDATE users SET email = COALESCE(NULLIF(?, ''), email),
      display_name = COALESCE(NULLIF(?, ''), display_name),
      country_code = COALESCE(NULLIF(?, ''), country_code),
      ui_lang = COALESCE(NULLIF(?, ''), ui_lang),
      consent_terms_at = CASE WHEN ? <> '' THEN ? ELSE consent_terms_at END,
      consent_marketing = ?,
      password_hash = CASE WHEN ? <> '' THEN ? ELSE password_hash END,
      last_seen = ? WHERE id = ?`).run(
      email, displayName || "", country || "", uiLang || "",
      consentTerms ? "1" : "", now, consentMarketing ? 1 : 0,
      pwdHash, pwdHash,
      now, userId);
  } else {
    d.prepare(`INSERT INTO users (id, email, display_name, country_code, ui_lang,
      consent_terms_at, consent_marketing, password_hash, created_at, last_seen)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      userId, email, displayName || "", country || "", uiLang || "",
      consentTerms ? now : "", consentMarketing ? 1 : 0, pwdHash, now, now);
  }
  return d.prepare("SELECT * FROM users WHERE id = ?").get(userId);
}

function getUserById(id) {
  const d = open();
  if (!d || !id) return null;
  return d.prepare("SELECT * FROM users WHERE id = ?").get(id) || null;
}

function getUserByEmail(email) {
  const d = open();
  email = normalizeEmail(email);
  if (!d || !email) return null;
  return d.prepare("SELECT * FROM users WHERE email = ?").get(email) || null;
}

function createConversation({ userId, title, country, uiLang, machine }) {
  const d = open();
  if (!d) return null;
  const id = uid("c");
  d.prepare(`INSERT INTO conversations (id, user_id, title, country_code, ui_lang, machine_profile)
    VALUES (?, ?, ?, ?, ?, ?)`).run(id, userId || "",
    String(title || "Neue Beratung").slice(0, 120), country || "", uiLang || "",
    machine ? JSON.stringify(machine).slice(0, 2000) : "");
  return d.prepare("SELECT * FROM conversations WHERE id = ?").get(id);
}

function touchConversation(id, title) {
  const d = open();
  if (!d || !id) return;
  if (title) {
    d.prepare("UPDATE conversations SET message_count = message_count + 1, updated_at = datetime('now'), title = ? WHERE id = ?")
      .run(String(title).slice(0, 120), id);
  } else {
    d.prepare("UPDATE conversations SET message_count = message_count + 1, updated_at = datetime('now') WHERE id = ?").run(id);
  }
}

function addMessage({ conversationId, role, content, imagesMeta, analysis, model, durationMs }) {
  const d = open();
  if (!d || !conversationId) return null;
  const id = uid("m");
  d.prepare(`INSERT INTO messages (id, conversation_id, role, content, images_meta, analysis, model, duration_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, conversationId, role,
    String(content || "").slice(0, 60000),
    imagesMeta ? String(imagesMeta).slice(0, 4000) : "",
    analysis ? JSON.stringify(analysis).slice(0, 60000) : "",
    model || "", durationMs || 0);
  touchConversation(conversationId);
  return id;
}

function listConversations(userId, limit = 50) {
  const d = open();
  if (!d) return [];
  return d.prepare(`SELECT id, title, country_code, ui_lang, message_count, created_at, updated_at
    FROM conversations WHERE user_id = ? AND (deleted_at IS NULL OR deleted_at = '')
    ORDER BY updated_at DESC LIMIT ?`).all(userId || "", Math.min(limit || 50, 200));
}

function getConversation(id, userId) {
  const d = open();
  if (!d || !id) return null;
  const conv = d.prepare("SELECT * FROM conversations WHERE id = ?").get(id);
  if (!conv || conv.deleted_at) return null;
  if (userId && conv.user_id && conv.user_id !== userId) return null;
  const msgs = d.prepare("SELECT role, content, images_meta, analysis, model, duration_ms, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC LIMIT 200").all(id);
  return { ...conv, messages: msgs };
}

function renameConversation(id, userId, title) {
  const d = open();
  if (!d || !id) return false;
  const conv = d.prepare("SELECT user_id FROM conversations WHERE id = ?").get(id);
  if (!conv) return false;
  if (userId && conv.user_id && conv.user_id !== userId) return false;
  d.prepare("UPDATE conversations SET title = ?, updated_at = datetime('now') WHERE id = ?")
    .run(String(title || "").slice(0, 120) || "Beratung", id);
  return true;
}

function deleteConversation(id, userId) {
  const d = open();
  if (!d || !id) return false;
  const conv = d.prepare("SELECT user_id FROM conversations WHERE id = ?").get(id);
  if (!conv) return false;
  if (userId && conv.user_id && conv.user_id !== userId) return false;
  d.prepare("UPDATE conversations SET deleted_at = datetime('now') WHERE id = ?").run(id);
  return true;
}

function createSession(userId) {
  const d = open();
  if (!d || !userId) return null;
  const token = crypto.randomBytes(24).toString("hex");
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  d.prepare("INSERT INTO sessions (token_hash, user_id) VALUES (?, ?)").run(hash, userId);
  return token;
}

function getUserByToken(token) {
  const d = open();
  if (!d || !token) return null;
  const hash = crypto.createHash("sha256").update(String(token)).digest("hex");
  const row = d.prepare("SELECT user_id FROM sessions WHERE token_hash = ?").get(hash);
  if (!row) return null;
  return d.prepare("SELECT * FROM users WHERE id = ?").get(row.user_id) || null;
}

function saveFeedback({ userId, conversationId, rating, message }) {
  const d = open();
  if (!d) return null;
  const id = uid("f");
  d.prepare("INSERT INTO feedback_db (id, user_id, conversation_id, rating, message) VALUES (?, ?, ?, ?, ?)")
    .run(id, userId || "", conversationId || "", rating || "", String(message || "").slice(0, 4000));
  return id;
}

// Full training dump for the "make the model better" loop.
// Returns { users, conversations, messages, feedback } with optional since filter.
function exportTrainingData(since) {
  const d = open();
  if (!d) return null;
  const s = since || "1970-01-01";
  return {
    exportedAt: new Date().toISOString(),
    users: d.prepare("SELECT id, email, display_name, country_code, ui_lang, consent_marketing, created_at FROM users WHERE created_at >= ?").all(s),
    conversations: d.prepare("SELECT * FROM conversations WHERE created_at >= ?").all(s),
    messages: d.prepare("SELECT * FROM messages WHERE created_at >= ? ORDER BY created_at ASC").all(s),
    feedback: d.prepare("SELECT * FROM feedback_db WHERE created_at >= ? ORDER BY created_at ASC").all(s),
  };
}

function recordLlmStat(s) {
  const d = open();
  if (!d) return;
  try {
    const day = new Date().toISOString().slice(0, 10);
    const kind = String((s && s.kind) || "?").slice(0, 16);
    const model = String((s && s.model) || "?").slice(0, 80);
    const inp = (s && s.usage && Number(s.usage.prompt_tokens)) || 0;
    const out = (s && s.usage && Number(s.usage.completion_tokens)) || 0;
    const ms = Math.max(0, Number((s && s.ms) || 0)) | 0;
    const err = s && s.error ? 1 : 0;
    d.prepare(`INSERT INTO llm_stats (day, kind, model, calls, errors, in_tokens, out_tokens, latency_ms)
      VALUES (?, ?, ?, 1, ?, ?, ?, ?)
      ON CONFLICT(day, kind, model) DO UPDATE SET calls = calls + 1, errors = errors + excluded.errors,
      in_tokens = in_tokens + excluded.in_tokens, out_tokens = out_tokens + excluded.out_tokens,
      latency_ms = latency_ms + excluded.latency_ms`).run(day, kind, model, err, inp, out, ms);
  } catch {}
}

function getLlmStats(days) {
  const d = open();
  if (!d) return [];
  try {
    const n = Math.min(90, Math.max(1, Number(days) || 7));
    return d.prepare(`SELECT * FROM llm_stats WHERE day >= date('now', '-' || ? || ' days') ORDER BY day DESC, kind`).all(n);
  } catch { return []; }
}

function stats() {
  const d = open();
  if (!d) return { disabled: disabledReason || true };
  return {
    users: d.prepare("SELECT COUNT(*) c FROM users").get().c,
    conversations: d.prepare("SELECT COUNT(*) c FROM conversations WHERE deleted_at = '' OR deleted_at IS NULL").get().c,
    messages: d.prepare("SELECT COUNT(*) c FROM messages").get().c,
    feedback: d.prepare("SELECT COUNT(*) c FROM feedback_db").get().c,
  };
}

module.exports = {
  ok, disabledReason: () => disabledReason, dbPath: DB_PATH,
  normalizeEmail, upsertUser, getUserById, getUserByEmail,
  hashPassword, verifyPassword,
  createSession, getUserByToken,
  createConversation, touchConversation, addMessage,
  listConversations, getConversation, renameConversation, deleteConversation,
  saveFeedback, exportTrainingData, stats, recordLlmStat, getLlmStats,
};
