/** Unit tests for the localized system notices.
 *  Run: npm test */
import assert from "node:assert/strict";
import { fitHeader, localizeNotes } from "../server/notices";
import { LANGUAGES } from "../server/intent";

let passed = 0;
function test(name: string, fn: () => void | Promise<void>) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`✓ ${name}`);
    })
    .catch((e: any) => {
      console.error(`✗ ${name}\n  ${e.message}`);
      process.exitCode = 1;
    });
}

await test("every supported language has a fit heading", () => {
  for (const lang of LANGUAGES) {
    assert.ok(fitHeader(lang).length > 0, `missing heading for ${lang}`);
  }
  assert.match(fitHeader("en"), /ISO 286/);
});

await test("German and empty input skip the translation call", async () => {
  const notes = ["Hinweis: gerechnet mit 8000 1/min."];
  assert.deepEqual(await localizeNotes(notes, "de"), notes);
  assert.deepEqual(await localizeNotes([], "en"), []);
});

console.log(`\n${passed} tests passed`);
