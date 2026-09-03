#!/usr/bin/env node
// LLM usage & cost visibility — reads data/app.db directly (no server needed).
// Tokens are recorded only when the upstream reports usage; calls, errors
// and latency are always counted. Euro costs are shown only when priced via
// env (LLM_EUR_PER_M_IN / LLM_EUR_PER_M_OUT, per million tokens) — otherwise
// tokens are reported without a euro figure (honest > invented).
const fs = require("fs");
const path = require("path");

const DB = process.env.APP_DB_PATH || path.join(__dirname, "..", "data", "app.db");
const EUR_IN = Number(process.env.LLM_EUR_PER_M_IN || 0);
const EUR_OUT = Number(process.env.LLM_EUR_PER_M_OUT || 0);

if (!fs.existsSync(DB)) {
  console.error("no db at", DB);
  process.exit(1);
}
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(DB, { readOnly: true });
let rows = [];
try {
  rows = db.prepare(
    "SELECT * FROM llm_stats WHERE day >= date('now', '-14 days') ORDER BY day DESC, kind"
  ).all();
} catch {
  console.log("no llm_stats yet — stats accumulate as chats run through the new llmFetch path.");
  process.exit(0);
}
db.close();
if (!rows.length) {
  console.log("no llm_stats in the last 14 days yet.");
  process.exit(0);
}

const pad = (s, n) => String(s).padEnd(n).slice(0, n);
console.log("day        kind   model                    calls  err   in-tok  out-tok  avg-ms");
console.log("─".repeat(84));
let t = { calls: 0, err: 0, inp: 0, out: 0, ms: 0 };
for (const r of rows) {
  const avg = r.calls ? Math.round(r.latency_ms / r.calls) : 0;
  console.log(`${r.day}  ${pad(r.kind, 6)} ${pad(r.model, 24)} ${String(r.calls).padStart(5)} ${String(r.errors).padStart(4)} ${String(r.in_tokens).padStart(7)} ${String(r.out_tokens).padStart(8)} ${String(avg).padStart(6)}`);
  t.calls += r.calls; t.err += r.errors; t.inp += r.in_tokens; t.out += r.out_tokens; t.ms += r.latency_ms;
}
console.log("─".repeat(84));
const errRate = t.calls ? ((100 * t.err) / t.calls).toFixed(1) : "0.0";
const avgAll = t.calls ? Math.round(t.ms / t.calls) : 0;
let total = `14d totals: ${t.calls} calls, ${t.err} errors (${errRate}%), ${t.inp} in / ${t.out} out tokens, ${avgAll} ms avg`;
if (EUR_IN > 0 || EUR_OUT > 0) {
  total += ` ≈ €${((t.inp / 1e6) * EUR_IN + (t.out / 1e6) * EUR_OUT).toFixed(2)}`;
} else {
  total += " (€ n/a — set LLM_EUR_PER_M_IN/OUT to price)";
}
console.log(total);
