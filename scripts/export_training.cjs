#!/usr/bin/env node
// Pull the training-data export from the running backend and store it under
// data/training/. Needs ADMIN_KEY (+ APP_KEY if set). Used for the
// "make the model better" loop: review conversations + feedback, promote good
// answers into data/gold_standards.json (see TRAINING.md).
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
  const text = await r.text();
  const lines = text.split("\n").filter(Boolean);
  const msgs = lines.filter((l) => l.includes('"type":"message"')).length;
  const fb = lines.filter((l) => l.includes('"type":"feedback"')).length;
  fs.writeFileSync(path.join(outDir, `export-${stamp}.jsonl`), text);
  console.log(`wrote data/training/export-${stamp}.jsonl — ${msgs} messages, ${fb} feedback rows`);
  console.log("next: review lines, promote the best answers into data/gold_standards.json (see TRAINING.md)");
})().catch((e) => { console.error("export error:", e.message); process.exit(1); });
