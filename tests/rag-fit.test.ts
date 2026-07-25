import assert from "assert";
import { parseFitSolutions } from "../server/rag";

const sample = `
## FERTIGE LÖSUNG
### Passung ∅50 H7/g6 — Spielpassung (berechnet)
Bohrung H7: G_oB = 50,025 mm, G_uB = 50,000 mm
Welle g6: G_oW = 49,990 mm, G_uW = 49,974 mm
P_SH (max Spiel) = 0,051 mm
P_ÜH (max Übermaß) = -0,010 mm
---
### [other]
`;

const fits = parseFitSolutions(sample);
assert.equal(fits.length, 1, "expected one fit");
assert.equal(fits[0].designation, "∅50 H7/g6");
assert.equal(fits[0].fitType, "Spielpassung");
assert.ok(Number.isFinite(fits[0].holeGo));
assert.ok(Number.isFinite(fits[0].psh));

// garbage numbers should not throw / should skip invalid
const bad = parseFitSolutions(`
## FERTIGE LÖSUNG
### Passung ∅10 H7/g6 — Spielpassung (berechnet)
Bohrung H7: G_oB = nan mm, G_uB = 10 mm
Welle g6: G_oW = 9 mm, G_uW = 8 mm
P_SH = 1 mm
P_ÜH = 0 mm
`);
assert.equal(bad.length, 0, "invalid numeric parse should be skipped");

console.log("rag-fit.test.ts: ok");
