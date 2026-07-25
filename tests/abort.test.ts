/** Unit tests for client-disconnect propagation.
 *  Run: npm test */
import assert from "node:assert/strict";
import { clientAborted, requestSignal, withRequestSignal } from "../server/abort";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (e: any) {
    console.error(`✗ ${name}\n  ${e.message}`);
    process.exitCode = 1;
  }
}

await test("outside a request: timeout signal only, never reported as aborted", () => {
  assert.equal(clientAborted(), false);
  assert.equal(requestSignal(1000).aborted, false);
});

await test("client disconnect aborts signals created inside the run", async () => {
  const ac = new AbortController();
  await withRequestSignal(ac.signal, async () => {
    const s = requestSignal(60_000);
    assert.equal(s.aborted, false);
    assert.equal(clientAborted(), false);
    ac.abort();
    await new Promise((r) => setImmediate(r));
    assert.equal(s.aborted, true);
    assert.equal(clientAborted(), true);
  });
});

await test("an aborted fetch rejects instead of hanging", async () => {
  const ac = new AbortController();
  ac.abort();
  await withRequestSignal(ac.signal, async () => {
    await assert.rejects(() => fetch("http://127.0.0.1:9/never", { signal: requestSignal(5000) }));
  });
});

console.log(`\n${passed} tests passed`);
