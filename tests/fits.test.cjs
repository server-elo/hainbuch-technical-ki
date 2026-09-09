const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");

const fits = require("../lib/fits.cjs");
const { precomputeFits } = require("../server/services/fitsService.cjs");

describe("ISO 286 Fits Engine", () => {
  test("computes 60 H7/h6 precision limits correctly", () => {
    const result = fits.fitResult(60, "H7", "h6");
    assert.ok(result, "Result should not be null");
    assert.match(result, /Ø60 H7\/h6/);
    assert.match(result, /D_min=60,000 mm/);
    assert.match(result, /D_max=60,030 mm/);
    assert.match(result, /d_min=59,981 mm/);
    assert.match(result, /d_max=60,000 mm/);
    assert.match(result, /S_min=0 µm/);
    assert.match(result, /S_max=49 µm/);
  });

  test("computes 50 H7/f7 clearance fit correctly", () => {
    const result = fits.fitResult(50, "H7", "f7");
    assert.ok(result, "Result should not be null");
    assert.match(result, /Ø50 H7\/f7/);
    assert.match(result, /D_min=50,000 mm/);
    assert.match(result, /D_max=50,025 mm/);
    assert.match(result, /S_min=25 µm/);
    assert.match(result, /S_max=75 µm/);
  });

  test("precomputeFits extracts fits from natural language prompt", () => {
    const query = "Ich fertige eine Welle mit Lagerzapfen Ø 60 h7 und Bohrung Ø 50 H7";
    const precomputed = precomputeFits(query);
    assert.ok(precomputed.includes("Ø60"), "Should detect Ø60");
    assert.ok(precomputed.includes("Ø50"), "Should detect Ø50");
    assert.ok(precomputed.includes("VORBEBERECHNETE PASSUNGEN"), "Should format header");
  });

  test("verifyFitNumbers catches and corrects slight typos", () => {
    const text = "Bohrung Ø50 H7: Mindestmaß 50,000 mm, Höchstmaß 50,025 mm.";
    const verified = fits.verifyFitNumbers(text);
    assert.ok(verified, "Should return verification result");
    assert.strictEqual(verified.corrections.length, 0, "No correction needed for correct text");
  });
});
