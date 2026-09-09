// Authentication endpoint (/api/auth/sync)
const { APP_KEY } = require("../config.cjs");
const { readJsonBody } = require("../services/llmService.cjs");

let histDb = null;
let histAuth = null;
try { histDb = require("../../lib/db.cjs"); } catch {}
try { histAuth = require("../../lib/auth.cjs"); } catch {}

const firebaseMode = () => histAuth && histAuth.mode() === "firebase";

async function handleAuthSync(req, res) {
  if (APP_KEY && req.headers["x-app-key"] !== APP_KEY) {
    res.writeHead(401, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "unauthorized" }));
  }

  const p = await readJsonBody(req);
  if (p.__tooLarge || p.__invalid || !histDb || !histDb.ok()) {
    res.writeHead(p.__tooLarge ? 413 : 503, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: p.__tooLarge ? "payload too large" : "history db disabled" }));
  }

  let email = histDb.normalizeEmail(p.email);
  if (firebaseMode()) {
    const verified = histAuth ? await histAuth.getAuth(req).catch(() => null) : null;
    if (!verified || !verified.email) {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "login required" }));
    }
    email = histDb.normalizeEmail(verified.email);
  }

  if (!email) {
    res.writeHead(400, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "valid email required" }));
  }

  const prev = histDb.getUserByEmail(email);
  const password = String(p.password || "").trim();

  // Login mode
  if (p.loginOnly) {
    if (!prev) {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "not-registered" }));
    }
    if (prev.password_hash) {
      if (!password || !histDb.verifyPassword(password, prev.password_hash)) {
        res.writeHead(401, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "wrong-password" }));
      }
    } else if (password && password.length >= 6) {
      histDb.upsertUser({ email, password });
    }
  } else {
    // Register mode
    if (!password || password.length < 6) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "password-too-short" }));
    }
    if (prev && prev.password_hash) {
      res.writeHead(409, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "already-registered" }));
    }
    if ((!prev || !prev.consent_terms_at) && !p.consentTerms) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "terms-required" }));
    }
  }

  const userId = prev ? (password && !prev.password_hash ? (histDb.upsertUser({ email, password }) || {}).id : prev.id) : (histDb.upsertUser({
    email,
    password,
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
    ok: true,
    token,
    user: { id: user.id, email: user.email, displayName: user.display_name, country: user.country_code, uiLang: user.ui_lang },
  }));
}

module.exports = {
  handleAuthSync,
  firebaseMode,
};
