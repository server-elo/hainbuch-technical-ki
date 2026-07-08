import express from "express";
import fs from "fs";
import path from "path";
import { createServer as createViteServer } from "vite";

import { PORT, LMSTUDIO_URL, MODEL_ID, RAG_API_URL, LLM_TIMEOUT_MS } from "./config";
import { runPipeline } from "./pipeline";

export type { FitSolution } from "./rag";

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

async function startServer() {
  const app = express();

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Online mode: Firebase Hosting frontend calls through a tunnel — allow
  // cross-origin and require the shared key for the expensive endpoint.
  const APP_KEY = process.env.APP_KEY || "";
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-app-key");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });
  app.use(["/api/chat", "/api/feedback"], (req, res, next) => {
    if (APP_KEY && req.headers["x-app-key"] !== APP_KEY) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  });

  // Cost protection: per-IP sliding hour window + global daily budget.
  // Local requests (no Cloudflare header) are exempt — that's Lorenc testing.
  const RATE_PER_HOUR = Number(process.env.RATE_MAX_PER_HOUR || 20);
  const RATE_PER_DAY = Number(process.env.RATE_MAX_PER_DAY || 400);
  const rateBuckets = new Map<string, number[]>();
  let dayBudget = { day: "", used: 0 };
  app.use("/api/chat", (req, res, next) => {
    const ip = req.headers["cf-connecting-ip"];
    if (typeof ip !== "string") return next(); // localhost / direct
    const now = Date.now();
    const hits = (rateBuckets.get(ip) || []).filter((t) => now - t < 3_600_000);
    if (hits.length >= RATE_PER_HOUR) {
      res.status(429).json({ error: "Zu viele Anfragen — bitte in einer Stunde erneut versuchen." });
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    if (dayBudget.day !== today) dayBudget = { day: today, used: 0 };
    if (dayBudget.used >= RATE_PER_DAY) {
      res.status(429).json({ error: "Tagesbudget erreicht — bitte morgen erneut versuchen." });
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
      country: typeof req.headers["cf-ipcountry"] === "string" ? req.headers["cf-ipcountry"] : null,
    };
    fs.appendFile(
      path.join(process.cwd(), "feedback.jsonl"),
      JSON.stringify(entry) + "\n",
      (err) => { if (err) console.error("[Feedback]", err); }
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

  // Mini-Admin (localhost only): feedback tail + daily budget at a glance.
  app.get("/api/admin", (req, res) => {
    if (typeof req.headers["cf-connecting-ip"] === "string") {
      res.status(403).json({ error: "localhost only" });
      return;
    }
    let feedback: any[] = [];
    try {
      feedback = fs
        .readFileSync(path.join(process.cwd(), "feedback.jsonl"), "utf8")
        .trim().split("\n").slice(-50).map((l) => JSON.parse(l));
    } catch { /* none yet */ }
    res.json({ feedback, dayBudget, ratePerHour: RATE_PER_HOUR, ratePerDay: RATE_PER_DAY });
  });

  // Live system status for the header chips. Cloudflare (tunnel) sets
  // CF-IPCountry — the frontend uses it to pick the UI language by location.
  app.get(["/api/status", "/health"], async (req, res) => {
    let rag = false;
    let llm = false;
    try {
      const r = await fetch(`${RAG_API_URL}/health`, { signal: AbortSignal.timeout(2000) });
      rag = r.ok && (await r.json()).engine_loaded === true;
    } catch { /* offline */ }
    try {
      const r = await fetch(`${LMSTUDIO_URL}/models`, { signal: AbortSignal.timeout(2000) });
      llm = r.ok;
    } catch { /* offline */ }
    const country = typeof req.headers["cf-ipcountry"] === "string"
      ? (req.headers["cf-ipcountry"] as string).toUpperCase()
      : null;
    res.json({ model: MODEL_ID, ragOnline: rag, llmOnline: llm, country });
  });

  // Streaming endpoint: NDJSON pipeline events, final line carries the result.
  app.post("/api/chat", async (req, res) => {
    console.log(`[API] /api/chat (model=${MODEL_ID}, rag=${RAG_API_URL})`);
    const { messages, lastAnalysis } = req.body;
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
    try {
      const result = await runPipeline(messages, emit, lastAnalysis ?? null);
      emit({ type: "result", data: result });
    } catch (error: any) {
      console.error("Pipeline error:", error);
      emit({ type: "error", error: error.message || "Failed to generate response" });
    } finally {
      clearInterval(heartbeat);
    }
    res.end();
  });

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

startServer();
