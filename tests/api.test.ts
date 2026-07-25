/** HTTP-level tests for the API middleware (auth, limits, admin, validation).
 *  The pipeline itself is never reached — requests fail validation first.
 *  Run: npm test */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";

process.env.NODE_ENV = "test";
process.env.APP_KEY = "test-key";
process.env.ADMIN_KEY = "admin-key";
process.env.TRUST_LOOPBACK = "0";
process.env.RATE_MAX_PER_HOUR = "3";
process.env.BODY_LIMIT_BYTES = "1024";
process.env.CHAT_BODY_LIMIT_BYTES = "4096";

const { createApiApp } = await import("../server/server");

const app = createApiApp();
const server = app.listen(0);
await new Promise((r) => server.once("listening", r));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

let passed = 0;
async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (e: any) {
    console.error(`✗ ${name}\n  ${e.message}`);
    process.exitCode = 1;
  }
}

const chat = (body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-app-key": "test-key", ...headers },
    body: JSON.stringify(body),
  });

await test("chat without the app key is rejected before any work", async () => {
  const res = await chat({ messages: [] }, { "x-app-key": "wrong" });
  assert.equal(res.status, 401);
});

await test("chat validates the messages array", async () => {
  const res = await chat({ messages: [] });
  assert.equal(res.status, 400);
});

await test("every response carries a request id", async () => {
  const res = await chat({ messages: [] });
  assert.match(res.headers.get("x-request-id") || "", /.+/);
  const given = await chat({ messages: [] }, { "x-request-id": "abc-123" });
  assert.equal(given.headers.get("x-request-id"), "abc-123");
});

await test("oversized chat bodies are refused with 413", async () => {
  const res = await chat({ messages: [{ role: "user", parts: [{ text: "x".repeat(5000) }] }] });
  assert.equal(res.status, 413);
});

await test("non-chat routes use the tighter body limit", async () => {
  const res = await fetch(`${base}/api/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-app-key": "test-key" },
    body: JSON.stringify({ rating: "up", message: "y".repeat(2000) }),
  });
  assert.equal(res.status, 413);
});

await test("feedback rejects an invalid rating", async () => {
  const res = await fetch(`${base}/api/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-app-key": "test-key" },
    body: JSON.stringify({ rating: "sideways" }),
  });
  assert.equal(res.status, 400);
});

await test("admin is reachable from loopback and reports the budget", async () => {
  const res = await fetch(`${base}/api/admin`);
  assert.equal(res.status, 200);
  const body: any = await res.json();
  assert.equal(typeof body.dayBudget.used, "number");
  assert.equal(body.ratePerHour, 3);
});

await test("per-IP rate limit closes the endpoint after the hourly quota", async () => {
  // 4 requests already went through above (all counted before validation).
  const res = await chat({ messages: [] });
  assert.equal(res.status, 429);
});

server.close();
console.log(`\n${passed} tests passed`);
