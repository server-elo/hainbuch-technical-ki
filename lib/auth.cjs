// Auth: Firebase ID-token verify when configured, stub mode otherwise.
//
// Phase 1 (now): email-based stub. Client sends Authorization: Bearer <token>
// (opaque session id from /api/auth/sync) or x-user-email. Server maps to a
// users row. No passwords touch this server in stub mode.
//
// Phase 2 (Firebase): set FIREBASE_PROJECT_ID (+ optionally FIREBASE_TENANT).
// getAuth() then verifies RS256 ID tokens against Google's JWKS (cached 1h).
// The same users row is reused (matched by email, then uid), so history
// migrates seamlessly when you switch modes.
const crypto = require("crypto");
const db = require("./db.cjs");

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || "";
let jwksCache = { keys: [], at: 0 };

function hashToken(t) {
  return crypto.createHash("sha256").update(String(t || "")).digest("hex").slice(0, 24);
}

function b64urlJson(s) {
  try {
    const b = Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");
    return JSON.parse(b.toString("utf8"));
  } catch { return null; }
}

async function verifyFirebaseIdToken(token) {
  if (!PROJECT_ID || !token) return null;
  const parts = String(token).split(".");
  if (parts.length !== 3) return null;
  const header = b64urlJson(parts[0]);
  const payload = b64urlJson(parts[1]);
  if (!header || !payload) return null;
  if (payload.aud !== PROJECT_ID) return null;
  if (payload.exp && payload.exp * 1000 < Date.now()) return null;
  try {
    if (Date.now() - jwksCache.at > 3600_000) {
      const r = await fetch("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
        { signal: AbortSignal.timeout(5000) });
      const j = await r.json();
      jwksCache = { keys: j.keys || [], at: Date.now() };
    }
    const key = jwksCache.keys.find((k) => k.kid === header.kid);
    if (!key) return null;
    const { createPublicKey, createVerify } = require("crypto");
    const pub = createPublicKey({ key, format: "jwk" });
    const v = createVerify("RSA-SHA256");
    v.update(parts[0] + "." + parts[1]);
    if (!v.verify(pub, Buffer.from(parts[2].replace(/-/g, "+").replace(/_/g, "/"), "base64"))) return null;
    return { uid: payload.user_id || payload.sub, email: payload.email || "" };
  } catch { return null; }
}

// Returns { uid, email, mode } or null for anonymous guests.
async function getAuth(req) {
  const h = req.headers || {};
  const bearer = typeof h.authorization === "string" && h.authorization.startsWith("Bearer ")
    ? h.authorization.slice(7).trim() : "";
  // 1) Firebase mode
  if (PROJECT_ID && bearer) {
    const fb = await verifyFirebaseIdToken(bearer);
    if (fb) {
      let user = fb.email ? db.getUserByEmail(fb.email) : null;
      if (!user) user = db.upsertUser({ id: "fb_" + hashToken(fb.uid), email: fb.email });
      else if (!String(user.id).startsWith("fb_")) {
        // link stub row to firebase uid on first verified login
        user = db.upsertUser({ id: user.id, email: fb.email });
      }
      return { uid: user ? user.id : "fb_" + hashToken(fb.uid), email: fb.email || "", mode: "firebase" };
    }
  }
  // 2) Stub mode: session token issued by /api/auth/sync
  if (bearer) {
    const user = db.getUserByToken(bearer);
    if (user) return { uid: user.id, email: user.email || "", mode: "stub" };
  }
  // 3) Stub mode only: plain email header. Disabled in Firebase mode —
  // tunnel traffic is unauthenticated, so this header proves nothing.
  const emailHeader = db.normalizeEmail(h["x-user-email"]);
  if (emailHeader && !PROJECT_ID) {
    const user = db.getUserByEmail(emailHeader);
    if (user) return { uid: user.id, email: user.email || "", mode: "stub-email" };
    return { uid: "", email: emailHeader, mode: "guest-email" };
  }
  return null;
}

module.exports = { getAuth, mode: () => (PROJECT_ID ? "firebase" : "stub"), projectId: PROJECT_ID };
