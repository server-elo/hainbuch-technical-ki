// Feedback endpoint (/api/feedback)
const fs = require("fs");
const path = require("path");
const { APP_KEY, ROOT_DIR } = require("../config.cjs");
const { checkFeedbackLimit } = require("../middleware/rateLimiter.cjs");

let histDb = null;
try { histDb = require("../../lib/db.cjs"); } catch {}

const FEEDBACK_FILE = path.join(ROOT_DIR, "feedback.jsonl");

function handleFeedback(req, res) {
  if (APP_KEY && req.headers["x-app-key"] !== APP_KEY) {
    res.writeHead(401, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "unauthorized" }));
  }
  if (checkFeedbackLimit(req, res)) return;

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
    if (fbTooLarge) return;
    let rating = null;
    let message = "";
    let conversationId = "";
    try {
      const p = JSON.parse(fbBody || "{}");
      rating = p.rating;
      message = p.message;
      conversationId = p.conversationId || "";
    } catch {}

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

    fs.appendFile(FEEDBACK_FILE, JSON.stringify(entry) + "\n", (err) => {
      if (err) console.error("[Feedback]", err);
    });

    try {
      if (histDb && histDb.ok()) {
        const em = histDb.normalizeEmail(req.headers["x-user-email"]);
        const u = em ? (histDb.getUserByEmail(em) || null) : null;
        histDb.saveFeedback({
          userId: u ? u.id : "",
          conversationId: String(conversationId).slice(0, 64),
          rating,
          message: entry.message,
        });
      }
    } catch (e) {
      console.warn("[Feedback] db mirror failed:", e.message);
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
}

module.exports = {
  handleFeedback,
};
