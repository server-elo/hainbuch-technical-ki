/** Unit tests for the clamping-force check (kc from Fachkunde Tabelle 1).
 *  Run: npm test */
import assert from "node:assert/strict";
import { checkClamping, cuttingForceN, kcFor, powerLimitFactor } from "../clamping_check";

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

const near = (a: number, b: number, tol = 0.03) =>
  assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} ≉ ${b}`);

test("kc grid values match the Fachkunde table exactly", () => {
  near(kcFor("baustahl", 0.3)!.kc, 2130); // E295 @ h=0,3
  near(kcFor("verguetungsstahl", 0.1)!.kc, 2700); // C35E @ h=0,1
  near(kcFor("automatenstahl", 0.8)!.kc, 1365); // 9SMn28 @ h=0,8
  assert.match(kcFor("baustahl", 0.3)!.source, /Fachkunde/);
});

test("kc interpolates linearly between grid points and clamps at the ends", () => {
  // E295: h=0,4 → between 2130 (0,3) und 1845 (0,5) → 1987,5
  near(kcFor("baustahl", 0.4)!.kc, 1987.5);
  near(kcFor("baustahl", 0.05)!.kc, 2995); // clamped to h=0,1
  near(kcFor("baustahl", 2.0)!.kc, 1605); // clamped to h=0,8
});

test("Fachkunde worked example reproduced: 16MnCr5, ap 4, f 0,4 (κ90 statt κ45)", () => {
  // Book (κ45): h=0,28 → kc≈1990 → Fc=3184 N. With our conservative κ90: h=f=0,4
  // → kc interpolated ≈ 1857 → Fc = 1857·4·0,4 ≈ 2971 N (same order, slightly lower kc at larger h).
  const r = cuttingForceN(
    { stepName: "Überdrehen", operationType: "drehen", apMm: 4, feedUsed: 0.4, diameterMm: 60 },
    "einsatzstahl"
  );
  near(r.h, 0.4);
  near(r.kc, 1990 - ((0.4 - 0.3) / 0.2) * (1990 - 1725)); // 1857,5
  near(r.force, 2972, 0.01);
});

test("drehen hand calculation: baustahl ap 3, f 0,3 → kc 2130 → Fc 1917 N", () => {
  const r = cuttingForceN(
    { stepName: "Schruppen", operationType: "drehen", apMm: 3, feedUsed: 0.3, diameterMm: 60 },
    "baustahl"
  );
  near(r.force, 2130 * 3 * 0.3);
});

test("fräsen: flat guide value for aluminium (not in the book table)", () => {
  // ap 5, ae 8, vf 1000 → Q = 40 cm³/min; vc 300 → Fc = 40·800/300 ≈ 107 N
  const r = cuttingForceN(
    { stepName: "Schruppen", operationType: "fräsen", apMm: 5, aeMm: 8, feedRateMmPerMin: 1000, vcUsed: 300, feedUsed: 0.1, diameterMm: 16 },
    "aluminium"
  );
  near(r.force, 106.7);
  assert.match(r.source, /Richtwert/);
});

test("traffic light thresholds", () => {
  const ops = [{ stepName: "Drehen", operationType: "drehen", apMm: 3, feedUsed: 0.3, diameterMm: 60 }];
  // baustahl: Fc = 1917 N → required = 1917·2/0,2 = 19,17 kN (µ 0,2 aus Fachkunde Reibungszahlen-Tabelle)
  const c = checkClamping(ops, "baustahl", [
    { product: "Stark", catalogForceKn: 30 },   // 1,57 → passt
    { product: "Mittel", catalogForceKn: 25 },  // 1,30 → knapp
    { product: "Schwach", catalogForceKn: 12 }, // 0,63 → zu klein
    { product: "Ohne Daten", catalogForceKn: null },
  ])!;
  near(c.requiredClampForceKn, 19.2);
  assert.equal(c.products[0].verdict, "passt");
  assert.equal(c.products[1].verdict, "knapp");
  assert.equal(c.products[2].verdict, "zu klein");
  assert.equal(c.products[3].verdict, "unbekannt");
});

test("note cites the Fachkunde source, TESTit and VDI 3106", () => {
  const c = checkClamping(
    [{ stepName: "Drehen", operationType: "drehen", apMm: 3, feedUsed: 0.3 }],
    "baustahl",
    [{ product: "X", catalogForceKn: 50 }]
  )!;
  assert.match(c.note, /Fachkunde Tab\. 1, E295/);
  assert.match(c.note, /Fachkunde Reibungszahlen-Tabelle, Stahl\/Stahl trocken/);
  assert.match(c.note, /TESTit/);
  assert.match(c.note, /VDI 3106/);
});

test("null when material unknown or nothing computable", () => {
  assert.equal(checkClamping([], "baustahl", [{ product: "X", catalogForceKn: 1 }]), null);
  assert.equal(
    checkClamping(
      [{ stepName: "Bohren", operationType: "bohren", diameterMm: 10 }],
      "baustahl",
      [{ product: "X", catalogForceKn: 1 }]
    ),
    null
  );
  assert.equal(
    checkClamping(
      [{ stepName: "Drehen", operationType: "drehen", apMm: 3, feedUsed: 0.3 }],
      "unbekanntes_material",
      [{ product: "X", catalogForceKn: 1 }]
    ),
    null
  );
});


test("Leistungsgrenze nach Fachkunde-Formel: Pc = Fc·vc/60000", () => {
  // baustahl drehen ap 3, f 0,3 → Fc 1917 N; vc 300 → Pc = 9,6 kW
  const op = { stepName: "Schruppen", operationType: "drehen", apMm: 3, feedUsed: 0.3, vcUsed: 300, diameterMm: 60 };
  // 5-kW-Maschine × η 0,8 = 4 kW Schnittleistung → Faktor 9,6/4 = 2,4
  near(powerLimitFactor(op, "baustahl", 4), 2.4, 0.01);
  // 20-kW-Maschine → keine Begrenzung
  near(powerLimitFactor(op, "baustahl", 16), 1);
  // Bohren nie leistungsbegrenzt (axial, hier nicht bewertet)
  near(powerLimitFactor({ stepName: "B", operationType: "bohren", vcUsed: 90 }, "baustahl", 1), 1);
});

console.log(`\n${passed} tests passed`);
