// Conversation history endpoint (/api/history and /api/history/:id)
const { APP_KEY } = require("../config.cjs");
const { readJsonBody } = require("../services/llmService.cjs");
const { firebaseMode } = require("./authRoute.cjs");

let histDb = null;
let histAuth = null;
try { histDb = require("../../lib/db.cjs"); } catch {}
try { histAuth = require("../../lib/auth.cjs"); } catch {}

async function resolveHistoryUser(req) {
  if (!histDb || !histDb.ok()) return { err: "history db disabled" };
  const auth = histAuth ? await histAuth.getAuth(req).catch(() => null) : null;
  let user = auth && auth.uid ? histDb.getUserById(auth.uid) : null;
  const email = histDb.normalizeEmail((auth && auth.email) || (!firebaseMode() ? req.headers["x-user-email"] : ""));
  if (!user && email) user = histDb.getUserByEmail(email) || (!firebaseMode() ? histDb.upsertUser({ email }) : null);
  if (!user) return { err: "login required" };
  return { user };
}

async function handleHistory(req, res, rawUrl) {
  if (APP_KEY && req.headers["x-app-key"] !== APP_KEY) {
    res.writeHead(401, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "unauthorized" }));
  }

  const { user, err } = await resolveHistoryUser(req);
  if (err) {
    res.writeHead(err === "login required" ? 401 : 503, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: err }));
  }

  // Collection: GET /api/history or POST /api/history
  if (rawUrl === "/api/history") {
    if (req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ conversations: histDb.listConversations(user.id) }));
    }
    if (req.method === "POST") {
      const p = await readJsonBody(req);
      if (p.__tooLarge || p.__invalid) {
        res.writeHead(p.__tooLarge ? 413 : 400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "invalid body" }));
      }
      const conv = histDb.createConversation({
        userId: user.id,
        title: String(p.title || "Neue Beratung").slice(0, 120),
        country: String(p.country || user.country_code || "").slice(0, 4),
        uiLang: String(p.uiLang || user.ui_lang || "").slice(0, 8),
        machine: p.machine,
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ conversation: conv }));
    }
  }

  // Individual item: /api/history/:id
  if (rawUrl.startsWith("/api/history/")) {
    const id = decodeURIComponent(rawUrl.slice("/api/history/".length)).split("/")[0].slice(0, 64);
    if (req.method === "GET") {
      const conv = histDb.getConversation(id, user.id);
      if (!conv) {
        res.writeHead(404, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "not found" }));
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ conversation: conv }));
    }
    if (req.method === "DELETE") {
      const okDel = histDb.deleteConversation(id, user.id);
      res.writeHead(okDel ? 200 : 404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(okDel ? { ok: true } : { error: "not found" }));
    }
    if (req.method === "PUT") {
      const p = await readJsonBody(req);
      if (p.__tooLarge || p.__invalid) {
        res.writeHead(p.__tooLarge ? 413 : 400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "invalid body" }));
      }
      const okRen = histDb.renameConversation(id, user.id, p.title);
      res.writeHead(okRen ? 200 : 404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(okRen ? { ok: true } : { error: "not found" }));
    }
  }

  res.writeHead(405, { "Content-Type": "application/json" });
  return res.end(JSON.stringify({ error: "method not allowed" }));
}

module.exports = {
  handleHistory,
  resolveHistoryUser,
};
