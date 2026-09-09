// HAINBUCH Technical Advisor Server Entrypoint
// Architecture: Modularized into server/ (config, prompts, services, middleware, routes, app)
const { PORT, APP_KEY, ADMIN_KEY } = require("./server/config.cjs");
const { createServer } = require("./server/app.cjs");

process.on("uncaughtException", (err) => {
  console.error(`[fatal] uncaughtException: ${err && err.stack || err}`);
});
process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.stack : String(reason);
  console.error(`[fatal] unhandledRejection: ${msg}`);
});

const server = createServer();

server.listen(PORT, () => {
  console.log(`HAINBUCH Gemini-only API auf http://localhost:${PORT}`);
  if (!process.env.BASE_URL) {
    console.warn("[Config] BASE_URL not set — photo URLs fall back to localhost and will be broken on the live site. Set BASE_URL=https://<tunnel-url>");
  }
  if (!APP_KEY) console.warn("[Config] APP_KEY not set — /api/chat + /api/feedback are open.");
  if (!ADMIN_KEY) console.warn("[Config] ADMIN_KEY not set — /api/admin allows loopback without key.");
});
