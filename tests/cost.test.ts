/** Unit tests for the deterministic cost comparison.
 *  Run: npm test */
import assert from "node:assert/strict";
import { compareCosts, actuationOf } from "../server/cost_compare";

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

test("actuation classified by product family", () => {
  assert.equal(actuationOf("HYDROK SE 100"), "hydraulisch");
  assert.equal(actuationOf("MANOK plus SE"), "manuell");
  assert.equal(actuationOf("TOROK SE"), "manuell");
  assert.equal(actuationOf("SPANNTOP nova"), "kraftbetätigt");
  assert.equal(actuationOf("Zentrierspanner XY"), "unbekannt");
});

test("hand calculation: 200 pcs @ 80 €/h, HYDROK vs MANOK", () => {
  const c = compareCosts(["HYDROK SE", "MANOK plus SE"], 200, 80, true)!;
  const hydrok = c.alternatives[0];
  const manok = c.alternatives[1];
  // HYDROK: 0.15 min × 200 = 30 min → 40 €. MANOK: 0.75 × 200 = 150 min → 200 €.
  assert.equal(hydrok.handlingMinSeries, 30);
  assert.equal(hydrok.handlingCostSeriesEur, 40);
  assert.equal(manok.handlingMinSeries, 150);
  assert.equal(manok.handlingCostSeriesEur, 200);
  assert.equal(manok.extraVsBestEur, 160);
  assert.equal(hydrok.extraVsBestEur, 0);
});

test("break-even statement names savings and hours", () => {
  const c = compareCosts(["HYDROK SE", "MANOK plus SE"], 200, 80, true)!;
  assert.match(c.note, /160 €/);
  assert.match(c.note, /2 Maschinenstunden/);
  assert.match(c.note, /Angebot/);
  assert.match(c.note, /Annahme/);
});

test("no assumption label when customer gave the rate", () => {
  const c = compareCosts(["HYDROK SE", "MANOK plus SE"], 100, 95, false)!;
  assert.doesNotMatch(c.note, /Annahme/);
  assert.match(c.note, /95 €\/h/);
});

test("null when fewer than 2 alternatives or no batch size", () => {
  assert.equal(compareCosts(["HYDROK SE"], 200, 80, true), null);
  assert.equal(compareCosts(["HYDROK SE", "MANOK"], NaN, 80, true), null);
  assert.equal(compareCosts(["HYDROK SE", "MANOK"], 0, 80, true), null);
});

console.log(`\n${passed} tests passed`);
