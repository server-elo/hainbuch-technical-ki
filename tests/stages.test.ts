/** Unit tests for the deterministic pipeline stages (no LLM involved).
 *  Run: npm test */
import assert from "node:assert/strict";
import { normalizeRawStock } from "../server/stages/rawstock";
import {
  conversationText,
  lastUserImages,
  lastUserDxf,
  lastUserPdf,
  lastUserText,
} from "../server/stages/messages";
import { normalizeRecommendations, buildSalesLayer } from "../server/stages/recommendations";
import { appendFitBlock } from "../server/stages/chat";
import { machineNotes } from "../server/stages/calc";

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (e: any) {
    console.error(`✗ ${name}\n  ${e.message}`);
    process.exitCode = 1;
  }
}

const inline = (mime: string, data = "AAA") => ({ inlineData: { mimeType: mime, data } });

test("raw stock is always larger than the finished part", () => {
  assert.equal(normalizeRawStock("Rundstange", [40, 100], "Ø40 x 100 mm"), "Ø45 x 106 mm");
  assert.equal(normalizeRawStock("Block", [50, 30, 10], "50 x 30 x 10 mm"), "55 x 35 x 15 mm");
});

test("raw stock keeps the LLM proposal when finished dimensions are unusable", () => {
  assert.equal(normalizeRawStock("Block", undefined, "Platte 100x50x8"), "Platte 100x50x8");
  assert.equal(normalizeRawStock("Block", [0, 20], "Platte 100x50x8"), "Platte 100x50x8");
});

test("conversation is rendered with speaker labels", () => {
  const text = conversationText([
    { role: "user", parts: [{ text: "Hallo" }] },
    { role: "model", parts: [{ text: "Guten Tag" }] },
  ]);
  assert.equal(text, "Kunde: Hallo\nBerater: Guten Tag");
});

test("drawings from earlier messages survive a clarifying question", () => {
  const messages = [
    { role: "user", parts: [inline("image/png"), { text: "Bitte planen" }] },
    { role: "model", parts: [{ text: "Welche Dicke?" }] },
    { role: "user", parts: [{ text: "10 mm" }] },
  ];
  assert.equal(lastUserImages(messages).length, 1);
  assert.equal(lastUserText(messages), "10 mm");
});

test("images are capped at three and never include dxf or pdf parts", () => {
  const messages = [
    { role: "user", parts: [inline("application/dxf", "D"), inline("application/pdf", "P")] },
    { role: "user", parts: [inline("image/png"), inline("image/png"), inline("image/jpeg"), inline("image/png")] },
  ];
  assert.equal(lastUserImages(messages).length, 3);
  assert.equal(lastUserDxf(messages), "D");
  assert.equal(lastUserPdf(messages), "P");
});

test("recommendations are deduplicated, capped and pinned to catalogue names", () => {
  const recs = normalizeRecommendations([
    { product: "TOPlus mini", description: "a (S. 12)", pros: ["gut (Seite 3)"] },
    { product: "toplus mini", description: "duplicate" },
    { product: "Schraubstock XY", description: "not hainbuch" },
    { product: "SPANNTOP nova", description: "b" },
    { product: "MANDO Adapt T211", description: "c" },
    { product: "MANOK plus", description: "d" },
  ]);
  assert.ok(recs.length <= 3);
  assert.ok(!recs.some((r) => /Schraubstock XY/.test(r.product)));
  assert.equal(new Set(recs.map((r) => r.product)).size, recs.length);
  assert.ok(!/S\. 12/.test(recs[0].description));
});

test("cost comparison needs two products and a batch size", () => {
  const material: any = { rawStock: { dimensions: "Ø45 x 106 mm" } };
  const one = buildSalesLayer({
    recommendations: [{ product: "TOPlus mini" }],
    plan: { batchSize: 200 },
    material,
  });
  assert.equal(one.costComparison, null);

  const two = buildSalesLayer({
    recommendations: [{ product: "MANOK plus" }, { product: "TOPlus mini" }],
    plan: { batchSize: null },
    material,
  });
  assert.equal(two.costComparison, null);
});

test("fit block is appended verbatim under a localized heading", () => {
  const context =
    "## FERTIGE LÖSUNG\nBohrung ∅22 H7: G_oB = 22,021 mm\n---\n### [andere Quelle]\nnoise";
  const out = appendFitBlock("Antwort", context, "en");
  assert.match(out, /ISO 286/);
  assert.match(out, /22,021/);
  assert.ok(!out.includes("noise"));
  assert.equal(appendFitBlock("Antwort", "kein Block", "de"), "Antwort");
});

test("machine notes reflect the source of the spindle data", () => {
  const base = {
    customerRpm: 12000,
    machine: "DMG MORI CLX 450",
    conversation: "",
    powerLimitedOps: [],
    machineKw: 15,
    kwSource: "annahme" as const,
  };
  assert.match(machineNotes({ ...base, rpmSource: "kunde" })[0], /Ihre maximale Spindeldrehzahl von 12000/);
  assert.match(machineNotes({ ...base, rpmSource: "recherche" })[0], /DMG MORI CLX 450/);
  assert.match(machineNotes({ ...base, rpmSource: "annahme" })[0], /Ohne Angabe zu Ihrer Maschine/);
  // Already stated earlier in the conversation → no repetition.
  assert.deepEqual(
    machineNotes({ ...base, rpmSource: "annahme", conversation: "… Spindeldrehzahl von 8000 1/min …" }),
    []
  );
});

test("power-limit note names the affected operations", () => {
  const [, note] = machineNotes({
    customerRpm: null,
    machine: null,
    conversation: "",
    rpmSource: "annahme",
    powerLimitedOps: ["Schruppfräsen"],
    machineKw: 11,
    kwSource: "kunde",
  });
  assert.match(note, /11 kW \(Ihre Angabe\).*Schruppfräsen/s);
});

console.log(`\n${passed} tests passed`);
