#!/usr/bin/env node
// HAINBUCH maintenance: log rotation + SQLite checkpoint + DB backup.
// Safe to run while lite-server is live. Run manually or via launchd.
// Usage: node scripts/maintenance.cjs [--dry-run]
const fs = require("fs");
const path = require("path");

const DRY = process.argv.includes("--dry-run");
const ROOT = path.join(__dirname, "..");
const LOGS = path.join(ROOT, "logs");
const DAILY = path.join(LOGS, "daily");
const DATA = path.join(ROOT, "data");
const BACKUPS = path.join(DATA, "backups");
const DB = process.env.APP_DB_PATH || path.join(DATA, "app.db");

const CHATS = path.join(LOGS, "chats.jsonl");
const CHATS_MAX_BYTES = 5 * 1024 * 1024;
const KEEP_ROTATED_CHATS = 7;
const KEEP_BACKUPS = 7;
const DAILY_KEEP_DAYS = 30;

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const mb = (n) => (n / 1048576).toFixed(1) + "MB";
const log = (...a) => console.log("[maintenance]", ...a);
const rm = (f) => { if (!DRY) fs.rmSync(f, { force: true }); };

function checkpointWal() {
  try {
    const { DatabaseSync } = require("node:sqlite");
    if (!fs.existsSync(DB)) return "no db file, skipped";
    const before = fs.existsSync(DB + "-wal") ? fs.statSync(DB + "-wal").size : 0;
    const db = new DatabaseSync(DB);
    // TRUNCATE collapses WAL back into the db file; BUSY_SNAPSHOT/PASSIVE
    // fallback keeps it safe while the server holds the db open.
    let r = db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
    if (!r || r.busy) r = db.prepare("PRAGMA wal_checkpoint(PASSIVE)").get();
    db.close();
    const after = fs.existsSync(DB + "-wal") ? fs.statSync(DB + "-wal").size : 0;
    return `WAL ${mb(before)} -> ${mb(after)} (${JSON.stringify(r)})`;
  } catch (e) {
    return `checkpoint failed (non-fatal): ${e.message}`;
  }
}

function backupDb() {
  if (!fs.existsSync(DB)) return "no db file, skipped";
  if (!DRY) fs.mkdirSync(BACKUPS, { recursive: true });
  const dest = path.join(BACKUPS, `app-${stamp()}.db`);
  if (!DRY) fs.copyFileSync(DB, dest);
  const files = fs.existsSync(BACKUPS)
    ? fs.readdirSync(BACKUPS).filter((f) => f.startsWith("app-") && f.endsWith(".db")).sort()
    : [];
  // prune old backups (account for the one we just wrote in non-dry runs)
  while (files.length > KEEP_BACKUPS) rm(path.join(BACKUPS, files.shift()));
  return `backup -> ${path.basename(dest)} (${mb(fs.existsSync(dest) && !DRY ? fs.statSync(dest).size : fs.statSync(DB).size)}), kept ${files.length}`;
}

function rotateChats() {
  if (!fs.existsSync(CHATS)) return "no chats.jsonl, skipped";
  const size = fs.statSync(CHATS).size;
  if (size < CHATS_MAX_BYTES) return `chats.jsonl ${mb(size)} < 5MB, kept`;
  const dest = path.join(LOGS, `chats-${stamp()}.jsonl`);
  if (!DRY) fs.renameSync(CHATS, dest);
  const rotated = fs.readdirSync(LOGS).filter((f) => /^chats-.*\.jsonl$/.test(f)).sort();
  while (rotated.length > KEEP_ROTATED_CHATS) rm(path.join(LOGS, rotated.shift()));
  return `rotated ${mb(size)} -> ${path.basename(dest)} (per-day archive in logs/daily/ is the permanent record)`;
}

function pruneDaily() {
  if (!fs.existsSync(DAILY)) return "no daily dir, skipped";
  const cutoff = Date.now() - DAILY_KEEP_DAYS * 86400000;
  let pruned = 0;
  for (const f of fs.readdirSync(DAILY)) {
    if (!/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)) continue; // never touch reports
    if (fs.statSync(path.join(DAILY, f)).mtimeMs < cutoff) { rm(path.join(DAILY, f)); pruned++; }
  }
  return `pruned ${pruned} daily jsonl older than ${DAILY_KEEP_DAYS}d (reports kept)`;
}

log(DRY ? "dry run" : "run", new Date().toISOString());
log("checkpoint:", checkpointWal());
log("backup:", backupDb());
log("rotate:", rotateChats());
log("prune:", pruneDaily());
log("done.");
