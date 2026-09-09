// Admin endpoints (/api/admin, /api/admin/export)
const fs = require("fs");
const path = require("path");
const { ADMIN_KEY, ROOT_DIR, RATE_PER_HOUR, RATE_PER_DAY } = require("../config.cjs");
const { isLoopback } = require("../middleware/rateLimiter.cjs");

let histDb = null;
let histAuth = null;
try { histDb = require("../../lib/db.cjs"); } catch {}
try { histAuth = require("../../lib/auth.cjs"); } catch {}

const FEEDBACK_FILE = path.join(ROOT_DIR, "feedback.jsonl");

function authorizeAdmin(req, res) {
  if (ADMIN_KEY) {
    if (req.headers["x-admin-key"] !== ADMIN_KEY) {
      res.writeHead(req.headers["x-admin-key"] ? 401 : 403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "localhost only" }));
      return false;
    }
  } else if (!isLoopback(req)) {
    res.writeHead(403, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "localhost only" }));
    return false;
  }
  return true;
}

function handleAdmin(req, res, rawUrl) {
  if (!authorizeAdmin(req, res)) return;

  if (rawUrl === "/api/admin/export") {
    if (!histDb || !histDb.ok()) {
      res.writeHead(503, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "history db disabled" }));
    }
    const q = new URL(req.url || "/", "http://x").searchParams;
    const data = histDb.exportTrainingData(q.get("since") || "1970-01-01");
    if (q.get("format") === "jsonl") {
      const lines = [];
      for (const m of data.messages) lines.push(JSON.stringify({ type: "message", ...m }));
      for (const f of data.feedback) lines.push(JSON.stringify({ type: "feedback", ...f }));
      res.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8" });
      return res.end(lines.join("\n") + (lines.length ? "\n" : ""));
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(data));
  }

  let feedback = [];
  try {
    feedback = fs.readFileSync(FEEDBACK_FILE, "utf8").trim().split("\n").slice(-50).map((l) => JSON.parse(l));
  } catch {}

  const dbStats = histDb ? histDb.stats() : { disabled: "no module" };
  res.writeHead(200, { "Content-Type": "application/json" });
  return res.end(JSON.stringify({
    feedback,
    ratePerHour: RATE_PER_HOUR,
    ratePerDay: RATE_PER_DAY,
    db: dbStats,
    authMode: histAuth ? histAuth.mode() : "none",
    llm: histDb ? histDb.getLlmStats(7) : [],
  }));
}

module.exports = {
  handleAdmin,
};
