import crypto from "crypto";
import express from "express";
import fs from "fs";
import path from "path";
import { createServer as createViteServer } from "vite";

import {
  PORT,
  LMSTUDIO_URL,
  MODEL_ID,
  RAG_API_URL,
  LLM_TIMEOUT_MS,
  CHAT_BODY_LIMIT_BYTES,
  BODY_LIMIT_BYTES,
} from "./config";
import { runPipeline } from "./pipeline";
import { withRequestSignal } from "./abort";

export type { FitSolution } from "./rag";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isLoopback(req: express.Request): boolean {
  const raw = req.socket.remoteAddress || "";
  return (
    raw === "127.0.0.1" ||
    raw === "::1" ||
    raw === "::ffff:127.0.0.1" ||
    raw.endsWith("/127.0.0.1")
  );
}

/** Prefer Cloudflare edge IP; otherwise socket IP (never treat missing CF as "trusted"). */
function clientIp(req: express.Request): string {
  const cf = req.headers["cf-connecting-ip"];
  if (typeof cf === "string" && cf.trim()) return cf.trim();
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.trim()) return xff.split(",")[0].trim();
  return req.socket.remoteAddress || "unknown";
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

/** All API middleware and routes — no Vite, no listen (used by tests too). */
export function createApiApp() {
  const app = express();

  // Stable request id for logs / client correlation.
  app.use((req, res, next) => {
    const incoming = req.headers["x-request-id"];
    const id =
      typeof incoming === "string" && incoming.trim()
        ? incoming.trim().slice(0, 64)
        : crypto.randomUUID();
    (req as any).requestId = id;
    res.setHeader("X-Request-Id", id);
    next();
  });

  // Reject oversized bodies early (before JSON parse / pipeline).
  // Chat may carry drawing base64 → higher cap; everything else stays tight.
  const CHAT_BODY_LIMIT = CHAT_BODY_LIMIT_BYTES;
  const DEFAULT_BODY_LIMIT = BODY_LIMIT_BYTES;
  app.use((req, res, next) => {
    const cl = req.headers["content-length"];
    if (!cl) return next();
    const n = Number(cl);
    if (!Number.isFinite(n) || n < 0) return next();
    const limit =
      req.path === "/api/chat" || req.originalUrl.startsWith("/api/chat")
        ? CHAT_BODY_LIMIT
        : DEFAULT_BODY_LIMIT;
    if (n > limit) {
      res.status(413).json({ error: "payload too large", limit });
      return;
    }
    next();
  });

  app.use(
    express.json({
      limit: CHAT_BODY_LIMIT,
      // Keep default type filter; size still gated above + per-route intent.
    })
  );
  app.use(express.urlencoded({ limit: DEFAULT_BODY_LIMIT, extended: true }));

  // Online mode: Firebase Hosting frontend calls through a tunnel — allow
  // cross-origin and require the shared key for the expensive endpoint.
  const APP_KEY = process.env.APP_KEY || "";
  // No APP_KEY fallback: APP_KEY ships in the VITE bundle and is public.
  const ADMIN_KEY = process.env.ADMIN_KEY || "";
  // When true (default), loopback clients skip per-IP rate limits for local dev.
  const TRUST_LOOPBACK = process.env.TRUST_LOOPBACK !== "0";

  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, x-app-key, x-admin-key, x-request-id"
    );
    res.setHeader("Access-Control-Expose-Headers", "X-Request-Id");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // Auth BEFORE expensive work. APP_KEY is a shared speed-bump (also in VITE bundle),
  // not multi-tenant security — still better than open /api/chat on a LAN bind.
  app.use(["/api/chat", "/api/feedback"], (req, res, next) => {
    if (APP_KEY && req.headers["x-app-key"] !== APP_KEY) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  });

  // Cost protection: per-IP sliding hour window + global daily budget.
  // Loopback is optionally exempt (TRUST_LOOPBACK). LAN peers are NOT exempt
  // just because Cloudflare headers are missing.
  const RATE_PER_HOUR = Number(process.env.RATE_MAX_PER_HOUR || 20);
  const RATE_PER_DAY = Number(process.env.RATE_MAX_PER_DAY || 400);
  const rateBuckets = new Map<string, number[]>();
  let dayBudget = { day: "", used: 0 };

  // Drop stale IP keys so the Map cannot grow without bound.
  const pruneRateBuckets = (now = Date.now()) => {
    for (const [ip, hits] of rateBuckets) {
      const fresh = hits.filter((t) => now - t < 3_600_000);
      if (fresh.length === 0) rateBuckets.delete(ip);
      else if (fresh.length !== hits.length) rateBuckets.set(ip, fresh);
    }
  };
  const pruneTimer = setInterval(() => pruneRateBuckets(), 10 * 60 * 1000);
  pruneTimer.unref?.();

  app.use("/api/chat", (req, res, next) => {
    if (TRUST_LOOPBACK && isLoopback(req)) return next();

    const ip = clientIp(req);
    const now = Date.now();
    const hits = (rateBuckets.get(ip) || []).filter((t) => now - t < 3_600_000);
    if (hits.length >= RATE_PER_HOUR) {
      res
        .status(429)
        .json({ error: "Zu viele Anfragen — bitte in einer Stunde erneut versuchen." });
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    if (dayBudget.day !== today) dayBudget = { day: today, used: 0 };
    if (dayBudget.used >= RATE_PER_DAY) {
      res
        .status(429)
        .json({ error: "Tagesbudget erreicht — bitte morgen erneut versuchen." });
      return;
    }
    hits.push(now);
    rateBuckets.set(ip, hits);
    dayBudget.used++;
    next();
  });

  // Thumbs up/down per answer → feedback.jsonl (the only source of real
  // weak spots once people use the app).
  app.post("/api/feedback", (req, res) => {
    const { rating, message } = req.body ?? {};
    if (rating !== "up" && rating !== "down") {
      res.status(400).json({ error: "rating must be up|down" });
      return;
    }
    const entry = {
      ts: new Date().toISOString(),
      rating,
      message: typeof message === "string" ? message.slice(0, 2000) : "",
      country:
        typeof req.headers["cf-ipcountry"] === "string"
          ? req.headers["cf-ipcountry"]
          : null,
      requestId: (req as any).requestId ?? null,
    };
    fs.appendFile(
      path.join(process.cwd(), "feedback.jsonl"),
      JSON.stringify(entry) + "\n",
      (err) => {
        if (err) console.error("[Feedback]", err);
      }
    );
    res.json({ ok: true });
  });

  // Catalogue product photos for the recommendation cards.
  app.use(
    "/product-images",
    express.static(path.join(process.cwd(), "assets/products"), {
      maxAge: "7d",
      immutable: true,
    })
  );

  // Mini-Admin: feedback tail + daily budget.
  // Loopback is open (local dev). Remote access needs ALLOW_REMOTE_ADMIN=1 and
  // a matching x-admin-key; the public APP_KEY is never accepted here.
  app.get("/api/admin", (req, res) => {
    if (!isLoopback(req)) {
      if (process.env.ALLOW_REMOTE_ADMIN !== "1" || !ADMIN_KEY) {
        res.status(403).json({ error: "localhost only" });
        return;
      }
      const provided = req.headers["x-admin-key"];
      if (typeof provided !== "string" || provided !== ADMIN_KEY) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }
    }
    let feedback: any[] = [];
    try {
      feedback = fs
        .readFileSync(path.join(process.cwd(), "feedback.jsonl"), "utf8")
        .trim()
        .split("\n")
        .slice(-50)
        .map((l) => JSON.parse(l));
    } catch {
      /* none yet */
    }
    res.json({
      feedback,
      dayBudget,
      ratePerHour: RATE_PER_HOUR,
      ratePerDay: RATE_PER_DAY,
      rateBucketIps: rateBuckets.size,
      requestId: (req as any).requestId,
    });
  });

  // Live system status for the header chips. Cloudflare (tunnel) sets
  // CF-IPCountry — the frontend uses it to pick the UI language by location.
  app.get(["/api/status", "/health"], async (req, res) => {
    let rag = false;
    let llm = false;
    try {
      const r = await fetch(`${RAG_API_URL}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      rag = r.ok && (await r.json()).engine_loaded === true;
    } catch {
      /* offline */
    }
    try {
      const r = await fetch(`${LMSTUDIO_URL}/models`, {
        signal: AbortSignal.timeout(2000),
      });
      llm = r.ok;
    } catch {
      /* offline */
    }
    const country =
      typeof req.headers["cf-ipcountry"] === "string"
        ? (req.headers["cf-ipcountry"] as string).toUpperCase()
        : null;
    res.json({
      model: MODEL_ID,
      ragOnline: rag,
      llmOnline: llm,
      country,
      requestId: (req as any).requestId,
    });
  });

  // Streaming endpoint: NDJSON pipeline events, final line carries the result.
  app.post("/api/chat", async (req, res) => {
    const rid = (req as any).requestId;
    console.log(
      `[API] /api/chat rid=${rid} (model=${MODEL_ID}, rag=${RAG_API_URL})`
    );
    const { messages, lastAnalysis } = req.body ?? {};
    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: "messages missing" });
      return;
    }
    res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Accel-Buffering", "no");
    const emit = (event: object) => {
      res.write(JSON.stringify(event) + "\n");
      (res as any).flush?.();
    };
    // Heartbeat: Cloudflare tunnels kill idle streams after ~100 s — the
    // plan stage can stay silent longer than that. Clients ignore "ping".
    const heartbeat = setInterval(() => emit({ type: "ping" }), 15000);
    // Client gone (tab closed, tunnel dropped) -> abort every in-flight LLM
    // and RAG call instead of finishing an answer nobody receives.
    // IMPORTANT: use res 'close', not req 'close'. On Node 20+/25 the request
    // stream closes as soon as the POST body is fully read, which would abort
    // the pipeline mid-LLM even while the response socket is still open.
    const aborter = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) aborter.abort();
    });
    try {
      const result = await withRequestSignal(aborter.signal, () =>
        runPipeline(messages, emit, lastAnalysis ?? null)
      );
      emit({ type: "result", data: result });
    } catch (error: any) {
      if (aborter.signal.aborted) {
        console.log(`[API] client disconnected — pipeline aborted rid=${rid}`);
      } else {
        console.error(`[API] Pipeline error rid=${rid}:`, error);
        emit({
          type: "error",
          error: error.message || "Failed to generate response",
        });
      }
    } finally {
      clearInterval(heartbeat);
    }
    res.end();
  });

  return app;
}

async function startServer() {
  const app = createApiApp();
  const APP_KEY = process.env.APP_KEY || "";

  if (process.env.NODE_ENV !== "production") {
    // Dev frontend must send the same key the backend checks — Vite only
    // exposes VITE_-prefixed vars to the client.
    if (APP_KEY && !process.env.VITE_APP_KEY) {
      process.env.VITE_APP_KEY = APP_KEY;
    }
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
  server.setTimeout(LLM_TIMEOUT_MS * 2);
}

// Skip auto-start when imported (tests use createApiApp directly).
if (process.env.NODE_ENV !== "test") startServer();
