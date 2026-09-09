// Rate limiter and IP resolution middleware
const crypto = require("crypto");
const {
  TRUST_LOOPBACK,
  RATE_PER_HOUR,
  RATE_PER_DAY,
  FEEDBACK_MAX_PER_HOUR,
} = require("../config.cjs");

const rateBuckets = new Map();
let dayBudget = { day: "", used: 0 };
const fbBuckets = new Map();

// Periodic cleanup of stale rate-limit buckets (every 10 min)
setInterval(() => {
  const now = Date.now();
  for (const [ip, hits] of rateBuckets) {
    const fresh = hits.filter((t) => now - t < 3_600_000);
    if (fresh.length === 0) rateBuckets.delete(ip);
    else rateBuckets.set(ip, fresh);
  }
  for (const [ip, hits] of fbBuckets) {
    const fresh = hits.filter((t) => now - t < 3_600_000);
    if (fresh.length === 0) fbBuckets.delete(ip);
    else fbBuckets.set(ip, fresh);
  }
}, 10 * 60 * 1000).unref?.();

function isLoopback(req) {
  const raw = (req.socket && req.socket.remoteAddress) || "";
  return (
    raw === "127.0.0.1" ||
    raw === "::1" ||
    raw === "::ffff:127.0.0.1" ||
    raw.endsWith("/127.0.0.1")
  );
}

function clientIp(req) {
  const cf = req.headers["cf-connecting-ip"];
  if (typeof cf === "string" && cf.trim()) return cf.trim().slice(0, 64);
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.trim()) return xff.split(",")[0].trim().slice(0, 64);
  const xr = req.headers["x-real-ip"];
  if (typeof xr === "string" && xr.trim()) return xr.trim().slice(0, 64);
  return (req.socket && req.socket.remoteAddress) || "unknown";
}

function hashIp(ip) {
  if (!ip || ip === "unknown") return "unknown";
  return crypto.createHash("sha256").update(String(ip)).digest("hex").slice(0, 12);
}

function checkRateLimit(req, res) {
  if (TRUST_LOOPBACK && isLoopback(req)) return false;
  const ip = clientIp(req);
  const now = Date.now();
  const hits = (rateBuckets.get(ip) || []).filter((t) => now - t < 3_600_000);

  const deny = (msg, retryAfterSec) => {
    res.writeHead(429, { "Content-Type": "application/json", "Retry-After": String(retryAfterSec) });
    res.end(JSON.stringify({ error: msg }));
    return true;
  };

  if (hits.length >= RATE_PER_HOUR) {
    const retryAfter = Math.max(1, Math.ceil((hits[0] + 3_600_000 - now) / 1000));
    return deny("Zu viele Anfragen — bitte in einer Stunde erneut versuchen.", retryAfter);
  }

  const today = new Date().toISOString().slice(0, 10);
  if (dayBudget.day !== today) dayBudget = { day: today, used: 0 };
  if (dayBudget.used >= RATE_PER_DAY) {
    const midnight = new Date(`${today}T24:00:00Z`).getTime();
    return deny("Tagesbudget erreicht — bitte morgen erneut versuchen.", Math.max(1, Math.ceil((midnight - now) / 1000)));
  }

  hits.push(now);
  rateBuckets.set(ip, hits);
  dayBudget.used++;
  return false;
}

function checkFeedbackLimit(req, res) {
  if (TRUST_LOOPBACK && isLoopback(req)) return false;
  const ip = clientIp(req);
  const now = Date.now();
  const hits = (fbBuckets.get(ip) || []).filter((t) => now - t < 3_600_000);

  if (hits.length >= FEEDBACK_MAX_PER_HOUR) {
    const retryAfter = Math.max(1, Math.ceil((hits[0] + 3_600_000 - now) / 1000));
    res.writeHead(429, { "Content-Type": "application/json", "Retry-After": String(retryAfter) });
    res.end(JSON.stringify({ error: "rate limited" }));
    return true;
  }

  hits.push(now);
  fbBuckets.set(ip, hits);
  return false;
}

module.exports = {
  isLoopback,
  clientIp,
  hashIp,
  checkRateLimit,
  checkFeedbackLimit,
};
