/** Regression gauntlet: gold questions against the LIVE advisor API.
 *
 *  Run:  npm run gauntlet          (server must be up on :3000)
 *  Fast mode (skip the slow full-pipeline case):  GAUNTLET_FAST=1 npm run gauntlet
 *
 *  Every check is a regex/predicate on the real end-to-end answer — if a
 *  prompt or retrieval change breaks an old capability, this is where it shows.
 */
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.GAUNTLET_URL || "http://localhost:3000";
const KEY = (() => {
  try { return fs.readFileSync(path.join(process.cwd(), ".app_key"), "utf8").trim(); }
  catch { return ""; }
})();

type Result = { message: string; [k: string]: any };
const u = (text: string) => ({ role: "user", parts: [{ text }] });

async function ask(messages: any[], lastAnalysis: any = null, timeoutMs = 600000): Promise<Result> {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-app-key": KEY },
    body: JSON.stringify({ messages, lastAnalysis }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  for (const line of text.trim().split("\n").reverse()) {
    try {
      const ev = JSON.parse(line);
      if (ev.type === "result") return ev.data;
      if (ev.type === "error") throw new Error(ev.error);
    } catch (e) {
      if (e instanceof SyntaxError) continue;
      throw e;
    }
  }
  throw new Error("no result event");
}

interface Case {
  name: string;
  slow?: boolean;
  run: () => Promise<{ ok: boolean; detail: string }>;
}

const CASES: Case[] = [
  {
    name: "Smalltalk bleibt kurz & freundlich",
    run: async () => {
      const r = await ask([u("Hallo!")]);
      return { ok: /hallo|helfen|unterstütz/i.test(r.message), detail: r.message.slice(0, 80) };
    },
  },
  {
    name: "Katalogfrage (TOPlus Rundlauf) — exakte Werte, keine Recherche-Floskel",
    run: async () => {
      const r = await ask([u("Welchen Rundlauf erreicht das TOPlus Spannfutter?")]);
      const ok = /0,0\d|µm/.test(r.message) && !/nicht aus den HAINBUCH/i.test(r.message);
      return { ok, detail: r.message.slice(0, 120) };
    },
  },
  {
    name: "Kernloch M10 → 8,5 mm (deterministischer Solver)",
    run: async () => {
      const r = await ask([u("Welchen Kernlochbohrer brauche ich für M10?")]);
      return { ok: /8,5\s*mm/.test(r.message), detail: r.message.slice(0, 120) };
    },
  },
  {
    name: "Passung 22 H7/g6 → Höchstspiel 0,041 mm (fit_solver)",
    run: async () => {
      const r = await ask([u("Passung Bohrung 22H7 mit Welle 22g6 — wie groß ist das Höchstspiel?")]);
      return { ok: /0,041/.test(r.message), detail: r.message.slice(-160) };
    },
  },
  {
    name: "Anziehdrehmoment M12 10.9 → 117 N·m (fachkunde_solvers)",
    run: async () => {
      const r = await ask([u("Mit welchem Drehmoment ziehe ich eine M12 Schraube 10.9 an?")]);
      return { ok: /117/.test(r.message), detail: r.message.slice(0, 160) };
    },
  },
  {
    name: "Härtetemperatur C35E → 840…880 °C (fachkunde_solvers)",
    run: async () => {
      const r = await ask([u("Bei welcher Temperatur härte ich C35E?")]);
      return { ok: /840/.test(r.message) && /880/.test(r.message), detail: r.message.slice(0, 160) };
    },
  },
  {
    name: "Rauheit Fertigschleifen → Rz 5…1 µm (fachkunde_solvers)",
    run: async () => {
      const r = await ask([u("Welche Rauheit erreiche ich beim Fertigschleifen?")]);
      return { ok: /5\s*…?\s*1|5\.\.\.1|Rz/.test(r.message), detail: r.message.slice(0, 160) };
    },
  },
  {
    name: "Maschinen-Empfehlungsfrage → Rückfragen statt Sackgasse",
    run: async () => {
      const r = await ask([u("was wurdest du mir fur my dmg mori 40 plus emphelhen")]);
      const ok = /Werkstoff/.test(r.message) && /Stückzahl/.test(r.message) && !/^Diese Information ist in den vorliegenden Unterlagen nicht enthalten\.?$/.test(r.message.trim());
      return { ok, detail: r.message.slice(0, 120) };
    },
  },
  {
    name: "Frage außerhalb der Unterlagen → Recherche mit Kennzeichnung",
    run: async () => {
      const r = await ask([u("Wie viel wiegt die DMG MORI CLX 450 ungefähr?")]);
      const ok = /(nicht aus den|recherchiert|prüfen)/i.test(r.message) && /\d/.test(r.message);
      return { ok, detail: r.message.slice(0, 120) };
    },
  },
  {
    name: "Neue Produktfamilie (TESTit) — geerdete Katalogantwort",
    run: async () => {
      const r = await ask([u("Was ist das TESTit Spannkraftmessgerät?")]);
      const ok = /Spannkraft|Einzugskraft|Messsystem/i.test(r.message) && !/nicht aus den HAINBUCH/i.test(r.message);
      return { ok, detail: r.message.slice(0, 120) };
    },
  },
  {
    name: "Folgefrage zum bestehenden Plan → KEIN Re-Planning (Konsistenz)",
    run: async () => {
      const analysis = {
        material: { name: "S355J2" },
        totalEstimatedMachiningTime: "4.35 min",
        operations: [
          { stepName: "Planfräsen OP10", operationType: "fräsen", tool: "Messerkopf D50", diameterMm: 50, cutLengthMm: 260, spindleSpeedRpm: 955, feedRateMmPerMin: 477, time: "0.63 min" },
        ],
      };
      const r = await ask(
        [
          { role: "user", parts: [{ text: "Konsole aus Baustahl, 96x65x64, 100 Stück" }] },
          { role: "model", parts: [{ text: "Arbeitsplan erstellt: Gesamtzeit 4.35 min. Empfehlung HYDROK Größe 100." }] },
          u("wo genau lege ich den nullpunkt hin und warum?"),
        ],
        analysis
      );
      const ok = !r.manufacturingAnalysis && /[Nn]ullpunkt/.test(r.message);
      return { ok, detail: `re-planned=${!!r.manufacturingAnalysis}; ${r.message.slice(0, 90)}` };
    },
  },
  {
    name: "Voller Fertigungsauftrag: Plan + Drehzahllimit + Empfehlungen + Kosten + Spannkraft",
    slow: true,
    run: async () => {
      const r = await ask([
        u("Flansch aus C45, Ø80 x 20 mm, Bohrung 22H7, 4x M8, 200 Stück, Maschine max. 6000 1/min"),
      ]);
      const ops = r.manufacturingAnalysis?.operations || [];
      const maxN = Math.max(0, ...ops.map((o: any) => o.spindleSpeedRpm || 0));
      const recs = Array.isArray(r.recommendations) ? r.recommendations.length : 0;
      const ok =
        ops.length >= 3 &&
        maxN <= 6000 &&
        recs >= 1 &&
        /6000/.test(r.message) &&
        (recs < 2 || !!r.costComparison) &&
        !!r.clampingCheck && r.clampingCheck.products.length >= 1;
      return {
        ok,
        detail: `${ops.length} Ops, n_max=${maxN}, ${recs} Empf., Kosten=${!!r.costComparison}, Spannkraft=${!!r.clampingCheck}`,
      };
    },
  },
];

(async () => {
  const fast = process.env.GAUNTLET_FAST === "1";
  let pass = 0, fail = 0;
  console.log(`Gauntlet gegen ${BASE} ${fast ? "(FAST — ohne Voll-Pipeline)" : ""}\n`);
  for (const c of CASES) {
    if (fast && c.slow) { console.log(`○ SKIP  ${c.name}`); continue; }
    const t0 = Date.now();
    try {
      const { ok, detail } = await c.run();
      const secs = ((Date.now() - t0) / 1000).toFixed(0);
      if (ok) { pass++; console.log(`✓ PASS  ${c.name}  (${secs}s)`); }
      else { fail++; console.log(`✗ FAIL  ${c.name}  (${secs}s)\n        → ${detail}`); }
    } catch (e: any) {
      fail++;
      console.log(`✗ ERROR ${c.name}\n        → ${e.message}`);
    }
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})();
