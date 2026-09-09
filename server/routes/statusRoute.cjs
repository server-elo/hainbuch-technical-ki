// Status and health endpoints (/api/status, /health)
const { MODEL_ID } = require("../config.cjs");
const { checkLlm } = require("../services/llmService.cjs");
const { getCounts } = require("../services/catalogService.cjs");

let histDb = null;
let histAuth = null;
try { histDb = require("../../lib/db.cjs"); } catch {}
try { histAuth = require("../../lib/auth.cjs"); } catch {}

async function handleStatus(req, res) {
  const url = (req.url || "").split("?")[0];
  const llmOnline = url === "/health" ? true : await checkLlm();
  const counts = getCounts();

  res.writeHead(200, { "Content-Type": "application/json" });
  return res.end(JSON.stringify({
    model: MODEL_ID,
    llmOnline,
    mode: "hainbuch-gemini-only",
    kb: counts.kb,
    catalog: counts.catalog,
    history: !!(histDb && histDb.ok()),
    authMode: histAuth ? histAuth.mode() : "none",
    country: typeof req.headers["cf-ipcountry"] === "string"
      ? req.headers["cf-ipcountry"].toUpperCase()
      : null,
  }));
}

module.exports = {
  handleStatus,
};
