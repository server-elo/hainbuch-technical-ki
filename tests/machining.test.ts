/** Unit tests for the deterministic machining calculator.
 *  Run: npm test  (plain tsx + assert — no framework needed) */
import assert from "node:assert/strict";
import { calculateOperation, calculatePlan, MATERIALS, slotFeedFactor } from "../machining";

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

const near = (a: number, b: number, tol = 0.02) =>
  assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≉ ${b}`);

test("drehen: n, vf, t match hand calculation", () => {
  // C45, D40, vc=180, f=0.3, L=120, 3 Schnitte
  const op = calculateOperation(
    { stepName: "Drehen", operationType: "drehen", tool: "CNMG", diameterMm: 40, cutLengthMm: 120, passes: 3, vcSuggested: 180, feedSuggested: 0.3 },
    "verguetungsstahl"
  );
  near(op.spindleSpeedRpm, (180 * 1000) / (Math.PI * 40)); // 1432
  near(op.feedRateMmPerMin, op.spindleSpeedRpm * 0.3);
  near(op.timeMin, ((120 + 2) * 3) / op.feedRateMmPerMin);
});

test("fräsen: vf = n·z·fz and approach allowance = D", () => {
  const op = calculateOperation(
    { stepName: "Planfräsen", operationType: "fräsen", tool: "Messerkopf D63 z5", diameterMm: 63, teeth: 5, cutLengthMm: 200, passes: 1, vcSuggested: 180, feedSuggested: 0.1 },
    "verguetungsstahl"
  );
  const n = (180 * 1000) / (Math.PI * 63); // 909.5
  near(op.spindleSpeedRpm, n, 0.01);
  near(op.feedRateMmPerMin, n * 5 * 0.1, 0.01);
  near(op.timeMin, (200 + 63) / (n * 5 * 0.1), 0.02); // 0.578
});

test("gewindebohren: DIN-13 pitch overrides wrong LLM pitch", () => {
  const op = calculateOperation(
    { stepName: "M8", operationType: "gewindebohren", tool: "Gewindebohrer M8", diameterMm: 8, cutLengthMm: 16, passes: 4, threadPitchMm: 1.5 /* wrong: M8 is 1.25 */, vcSuggested: 7 },
    "verguetungsstahl"
  );
  near(op.feedUsed, 1.25, 0.001);
  near(op.timeMin, (2 * 16 * 4) / (op.spindleSpeedRpm * 1.25), 0.02);
});

test("vc clamped to material Richtwert range", () => {
  const op = calculateOperation(
    { stepName: "Drehen", operationType: "drehen", tool: "CNMG", diameterMm: 40, cutLengthMm: 100, passes: 1, vcSuggested: 9999, feedSuggested: 0.3 },
    "verguetungsstahl"
  );
  assert.equal(op.vcUsed, MATERIALS.verguetungsstahl.vc.drehen.max);
});

test("spindle speed clamped to machine limit", () => {
  const op = calculateOperation(
    { stepName: "Fräsen", operationType: "fräsen", tool: "VHM D6 z3", diameterMm: 6, teeth: 3, cutLengthMm: 50, passes: 1, vcSuggested: 300, feedSuggested: 0.1 },
    "aluminium",
    8000
  );
  assert.equal(op.spindleSpeedRpm, 8000); // rechnerisch 15915 → Limit
});

test("plan totals: cutting time + tool changes", () => {
  const plan = calculatePlan(
    [
      { stepName: "A", operationType: "bohren", tool: "D10", diameterMm: 10, cutLengthMm: 20, passes: 1, vcSuggested: 70, feedSuggested: 0.2 },
      { stepName: "B", operationType: "reiben", tool: "D10H7", diameterMm: 10, cutLengthMm: 20, passes: 1, vcSuggested: 8, feedSuggested: 0.3 },
    ],
    "verguetungsstahl"
  );
  near(plan.totalCuttingTimeMin, plan.operations[0].timeMin + plan.operations[1].timeMin, 0.01);
  near(plan.totalTimeMin, plan.totalCuttingTimeMin + 0.15, 0.01); // 1 Werkzeugwechsel
});

test("unknown material falls back to baustahl", () => {
  const op = calculateOperation(
    { stepName: "X", operationType: "drehen", tool: "T", diameterMm: 40, cutLengthMm: 50, passes: 1, vcSuggested: 200, feedSuggested: 0.25 },
    "unobtainium"
  );
  assert.equal(op.vcUsed, 200); // within baustahl range 150-280
});


test("volume guard: roughing time raised to physical removal rate", () => {
  // L-Absatz: 40x65x44 mm ≈ 114 cm³ Alu, D16 Fräser — 0.48 min wäre unmöglich
  const op = calculateOperation(
    { stepName: "Schruppen", operationType: "fräsen", tool: "VHM D16 z3", diameterMm: 16, teeth: 3, cutLengthMm: 200, passes: 4, vcSuggested: 300, feedSuggested: 0.1, removalVolumeCm3: 114, apMm: 12, aeMm: 10 },
    "aluminium", 8000
  );
  const vf = op.feedRateMmPerMin;
  const expected = (114 * 1000) / (12 * 10 * vf);
  near(op.timeMin, expected, 0.02);
  assert.ok(op.calculation.includes("Volumen-Check"));
});

test("volume guard: no effect when path time already realistic", () => {
  const op = calculateOperation(
    { stepName: "Schlichten", operationType: "fräsen", tool: "VHM D12 z3", diameterMm: 12, teeth: 3, cutLengthMm: 500, passes: 6, vcSuggested: 300, feedSuggested: 0.05, removalVolumeCm3: 1, apMm: 0.5, aeMm: 2 },
    "aluminium", 8000
  );
  assert.ok(!op.calculation.includes("maßgebend"));
});


test("Fachkunde Tab. 2: Nutenfräs-Korrektur (fz 0,25 bei ae=d/6 → wirksam ~0,29)", () => {
  near(slotFeedFactor(10, 60), 1.15); // ae = d/6 → +15 %
  near(slotFeedFactor(5, 60), 1.45);  // ae = d/12 (Band ≤ d/10) → +45 %
  near(slotFeedFactor(3, 60), 2.0);   // ae = d/20 → +100 %
  near(slotFeedFactor(20, 60), 1);    // ae = d/3 → Basis
  near(0.25 * slotFeedFactor(10, 60), 0.2875);
});

test("Buch-Kalibrierung: Baustahl-Fräsbereiche = Fachkunde-HM-Tabelle", () => {
  const m = MATERIALS.baustahl;
  near(m.vc["fräsen"].min, 100);
  near(m.vc["fräsen"].max, 450);
  near(m.fz.min, 0.1);
  near(m.fz.max, 0.4);
});

test("Arbeitsplan zitiert die Fachkunde-Quelle", () => {
  const op = calculateOperation(
    { stepName: "Planfräsen", operationType: "fräsen", tool: "D50", diameterMm: 50, cutLengthMm: 100, teeth: 5, vcSuggested: 200, feedSuggested: 0.15 },
    "baustahl"
  );
  assert.match(op.calculation, /Fachkunde Tab\. 1 Fräsen/);
});

test("gewindedrehen: f = P, Durchgänge aus Fachkunde Tab. 1, t = i·L/(n·P)", () => {
  const op = calculateOperation(
    { stepName: "Gewinde M24x1,5", operationType: "gewindedrehen", tool: "Gewindedrehmeißel 60°", diameterMm: 24, cutLengthMm: 13, passes: 1 /* LLM-Wert wird überstimmt */, threadPitchMm: 1.5 },
    "verguetungsstahl"
  );
  assert.equal(op.passes, 6); // Fachkunde Tab. 1: P 1,5 → 6 Durchgänge
  near(op.feedUsed, 1.5, 0.001);
  assert.equal(op.feedUnit, "mm/U");
  near(op.timeMin, (6 * 13) / op.feedRateMmPerMin, 0.02);
  assert.match(op.calculation, /Fachkunde Tab\. 1 \(Gewindedrehen\)/);
});

test("gewindedrehen: vc 25 % unter Längsdrehen, HM-Untergrenze 40 m/min", () => {
  // Vergütungsstahl: drehen-Richtwert 240 → 180 m/min
  const steel = calculateOperation(
    { stepName: "M24x1,5", operationType: "gewindedrehen", tool: "GD", diameterMm: 24, cutLengthMm: 13, threadPitchMm: 1.5 },
    "verguetungsstahl"
  );
  assert.equal(steel.vcUsed, Math.round(MATERIALS.verguetungsstahl.vc.drehen.default * 0.75));
  // Titan: 0,75·50 = 37,5 → auf 40 m/min angehoben (Fachkunde: HM nicht unter 40)
  const ti = calculateOperation(
    { stepName: "M24x1,5", operationType: "gewindedrehen", tool: "GD", diameterMm: 24, cutLengthMm: 13, threadPitchMm: 1.5 },
    "titan"
  );
  assert.equal(ti.vcUsed, 40);
});

test("gewindedrehen: fehlende Steigung → DIN-13-Regelgewinde, Durchgänge extrapoliert", () => {
  const op = calculateOperation(
    { stepName: "Gewinde M24", operationType: "gewindedrehen", tool: "GD", diameterMm: 24, cutLengthMm: 20 },
    "baustahl"
  );
  near(op.threadPitchMm!, 3.0, 0.001); // M24 Regelgewinde P = 3 (DIN 13)
  near(op.feedUsed, 3.0, 0.001);
  assert.equal(op.passes, 12); // > Tabellenbereich: 4·P (gleiche mittlere Zustellung wie P 1,5)
  assert.match(op.calculation, /extrapoliert/);
});

console.log(`\n${passed} tests passed${process.exitCode ? " (with failures)" : ""}`);
