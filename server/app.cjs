// Main HTTP Application Request Dispatcher
const http = require("http");
const fs = require("fs");
const path = require("path");

const {
  PORT,
  APP_KEY,
  ADMIN_KEY,
  BASE_URL,
  HERO_DIR,
  SHOP_DIR,
  DIST_DIR,
} = require("./config.cjs");

const { checkRateLimit } = require("./middleware/rateLimiter.cjs");
const { handleStatus } = require("./routes/statusRoute.cjs");
const { handleChat } = require("./routes/chatRoute.cjs");
const { handleFeedback } = require("./routes/feedbackRoute.cjs");
const { handleAdmin } = require("./routes/adminRoute.cjs");
const { handleAuthSync } = require("./routes/authRoute.cjs");
const { handleHistory } = require("./routes/historyRoute.cjs");

function createServer() {
  return http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-app-key, x-admin-key, x-request-id, Authorization, x-user-email, x-ui-lang");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }

    const rawUrl = (req.url || "").split("?")[0];

    // 1. Status & Health
    if (req.method === "GET" && (rawUrl === "/api/status" || rawUrl === "/health")) {
      return handleStatus(req, res);
    }

    // 2. Static catalog and shop product images
    if ((req.method === "GET" || req.method === "HEAD") && (rawUrl.startsWith("/hero-img/") || rawUrl.startsWith("/shop-img/"))) {
      let file;
      try {
        file = path.basename(decodeURIComponent(rawUrl.replace(/^\/(hero-img|shop-img)\//, "")));
      } catch {
        res.writeHead(400);
        return res.end();
      }
      if (file.includes("..") || file.includes("/") || file.includes("\\")) {
        res.writeHead(400);
        return res.end();
      }
      const heroFull = path.join(HERO_DIR, file);
      const shopFull = path.join(SHOP_DIR, file);
      const resolved = fs.existsSync(heroFull) ? heroFull : (fs.existsSync(shopFull) ? shopFull : null);
      if (!resolved) {
        res.writeHead(404);
        return res.end();
      }
      const ext = path.extname(resolved).toLowerCase();
      const imgType = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : ext === ".svg" ? "image/svg+xml" : "image/jpeg";
      res.writeHead(200, { "Content-Type": imgType, "Cache-Control": "public, max-age=86400" });
      if (req.method === "HEAD") return res.end();
      const imgStream = fs.createReadStream(resolved);
      imgStream.on("error", () => {
        try { res.writeHead(500); } catch {}
        try { res.end(); } catch {}
      });
      return imgStream.pipe(res);
    }

    // 3. Chat Pipeline (SSE streaming)
    if (req.method === "POST" && rawUrl === "/api/chat") {
      if (APP_KEY && req.headers["x-app-key"] !== APP_KEY) {
        res.writeHead(401, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "unauthorized" }));
      }
      if (checkRateLimit(req, res)) return;
      return handleChat(req, res);
    }

    // 4. Feedback
    if (req.method === "POST" && rawUrl === "/api/feedback") {
      return handleFeedback(req, res);
    }

    // 5. Admin & Training Data Export
    if (req.method === "GET" && (rawUrl === "/api/admin" || rawUrl === "/api/admin/export")) {
      return handleAdmin(req, res, rawUrl);
    }

    // 6. User Auth Sync
    if (req.method === "POST" && rawUrl === "/api/auth/sync") {
      return handleAuthSync(req, res);
    }

    // 7. Conversation History
    if (rawUrl === "/api/history" || rawUrl.startsWith("/api/history/")) {
      return handleHistory(req, res, rawUrl);
    }

    // 8. Static Web UI (dist/) + SPA Fallback
    if (req.method === "GET") {
      let urlPath;
      try {
        urlPath = decodeURIComponent(rawUrl);
      } catch {
        res.writeHead(400);
        return res.end();
      }
      if (urlPath.startsWith("/api/")) {
        res.writeHead(404, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "not found" }));
      }

      const rel = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
      const full = path.normalize(path.join(DIST_DIR, rel));
      if (full !== DIST_DIR && !full.startsWith(DIST_DIR + path.sep)) {
        res.writeHead(403);
        return res.end();
      }
      const candidates = fs.existsSync(full) && fs.statSync(full).isFile()
        ? [full]
        : [path.join(DIST_DIR, "index.html")];
      const file = candidates[0];
      if (fs.existsSync(file)) {
        const types = {
          ".html": "text/html; charset=utf-8",
          ".js": "text/javascript; charset=utf-8",
          ".css": "text/css; charset=utf-8",
          ".svg": "image/svg+xml",
          ".png": "image/png",
          ".jpg": "image/jpeg",
          ".jpeg": "image/jpeg",
          ".ico": "image/x-icon",
          ".json": "application/json",
          ".webmanifest": "application/manifest+json",
          ".woff": "font/woff",
          ".woff2": "font/woff2",
        };
        const type = types[path.extname(file).toLowerCase()] || "application/octet-stream";
        res.writeHead(200, { "Content-Type": type, "Cache-Control": file.endsWith("index.html") ? "no-cache" : "public, max-age=3600" });
        const stream = fs.createReadStream(file);
        stream.on("error", () => {
          try { res.writeHead(500); } catch {}
          try { res.end(); } catch {}
        });
        return stream.pipe(res);
      }
    }

    res.writeHead(404);
    res.end();
  });
}

module.exports = {
  createServer,
};
