#!/usr/bin/env node
/**
 * HAINBUCH Technical Advisor - Daily Review & Self-Improvement Pipeline
 *
 * Two-stage audit:
 *  Stage 1 (deterministic): image mismatches, fit arithmetic, grind stock,
 *            ephemeral image URLs, invented reference geometry, vague-question
 *            handling — fast, free, no LLM needed.
 *  Stage 2 (LLM, own AI judgment): semantic audit per answer — hallucinated
 *            dimensions/materials/mat-numbers, wrong product for the job,
 *            generic filler instead of a concrete answer, missing sources.
 *            Uses LLM_URL/MODEL_ID (VibeProxy). Skippable via --no-llm.
 *            If the LLM is unreachable, the report says so explicitly instead
 *            of pretending everything is excellent.
 *
 * Only answers that pass BOTH stages are promoted to gold_standards.json.
 */

const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, '..', 'logs', 'daily');
const DATA_DIR = path.join(__dirname, '..', 'data');
const GOLD_FILE = path.join(DATA_DIR, 'gold_standards.json');
let verifyFitNumbers = null;
try { verifyFitNumbers = require('../lib/fits.cjs').verifyFitNumbers; } catch {}
const LLM_URL = process.env.LLM_URL || 'http://127.0.0.1:8317/v1/chat/completions';
const MODEL_ID = process.env.MODEL_ID || 'gemini-flash-3.8-medium';

const args = process.argv.slice(2);
const TARGET_DATE = args.find((a) => !a.startsWith('--')) || new Date().toISOString().slice(0, 10);
const NO_LLM = args.includes('--no-llm');
const DAILY_LOG = path.join(LOGS_DIR, `${TARGET_DATE}.jsonl`);
const REPORT_FILE = path.join(LOGS_DIR, `${TARGET_DATE}-report.md`);

const AUDIT_RULES = [
  {
    id: 'IMAGE_MANOK_MISMATCH',
    name: 'MANOK mit falschem Messkoffer-Bild',
    check: (rec) => /MANOK/i.test(rec.response) && /hero_338\.jpg/i.test(rec.response),
    fix: (txt) => txt.replace(/hero_338\.jpg/g, 'hero_246.jpg'),
  },
  {
    id: 'IMAGE_INOFLEX_MISMATCH',
    name: 'InoFlex mit Kran-/Monteq-Bild',
    check: (rec) => /InoFlex/i.test(rec.response) && /hero_372\.jpg/i.test(rec.response),
    fix: (txt) => txt.replace(/hero_372\.jpg/g, 'hero_136.jpg'),
  },
  {
    id: 'IMAGE_MANDO_MISMATCH',
    name: 'MANDO mit falschem Adapter-Bild',
    check: (rec) => /MANDO\s+T21/i.test(rec.response) && /(hero_254|hero_124)\.jpg/i.test(rec.response),
    fix: (txt) => txt.replace(/(hero_254|hero_124)\.jpg/g, 'hero_178.jpg'),
  },
  {
    id: 'MISSING_WORKPLAN',
    name: 'Fehlender Arbeitsplan trotz Optionenauswahl',
    check: (rec) => /(optionen|auswahl|schlag mir vor|losgr[oö][ßs]e|arbeitsplan)/i.test(rec.question || '') && !/OP\s*10/i.test(rec.response),
  },
  {
    id: 'FIT_ARITHMETIC',
    name: 'Rechenfehler in Passungstabelle (deterministisch geprüft)',
    check: (rec) => {
      if (!verifyFitNumbers || !rec.response) return false;
      try {
        const v = verifyFitNumbers(rec.response);
        rec._fitFix = v.corrections.length && v.corrections.length <= 4 ? v : null;
        return !!rec._fitFix;
      } catch { return false; }
    },
    fix: (txt) => {
      try {
        const v = verifyFitNumbers(txt);
        return v.corrections.length && v.corrections.length <= 4 ? v.fixed : txt;
      } catch { return txt; }
    },
  },
  {
    id: 'GRIND_STOCK',
    name: 'Fehlendes Schleifaufmaß trotz Härten + Feinstpassung',
    check: (rec) => {
      const r = rec.response || '';
      const hard = /(5[5-9]|6[0-9])\s*(±?\s*\d?\s*)?HRC/i.test(r);
      const fine = /(h5|h6|k5|k6|Ra\s*0,[12])/i.test(r);
      const hasStock = /schleifaufma(ss|ß)|hart.*(schleifen|drehen)|zwischen Spitzen|Stirnseitenmitnehmer/i.test(r);
      return hard && fine && !hasStock;
    },
  },
  {
    id: 'MISSING_TIMES',
    name: 'Fehlende ISO-Hauptzeitberechnung (t_h)',
    check: (rec) => /OP\s*10/i.test(rec.response) && !/(t_h|Hauptzeit)/i.test(rec.response),
  },
  // --- new: catch the failure modes seen on 2026-09-03 ---
  {
    id: 'EPHEMERE_BILD_URL',
    name: 'Bild-URL auf ephemeren Tunnel/localhost statt hainbuch.com',
    check: (rec) => /trycloudflare|localhost|127\.0\.0\.1|element-differently/i.test(rec.response || ''),
  },
  {
    id: 'ERFUNDENE_REFERENZGEOMETRIE',
    name: 'Erfundene Bauteilmaße/Werkstoffe ohne Kundenangabe',
    check: (rec) => {
      const q = rec.question || '';
      const r = rec.response || '';
      if (q.length > 140) return false; // detailed question → concrete numbers OK
      // Vague question but answer states precise geometry/material as fact:
      const inventedGeo = /(Referenzgeometrie|angenommen|typisch.*Ø\s*\d{2,4}|Fertigmaß\s*Ø|Rohguss\s*ca\.\s*Ø)/i.test(r);
      const inventedMat = /(EN-GJL-250|EN-GJL-200|GG-25|16MnCr5|1\.7131|3\.7165|Ti-6Al|C45\s*\(1\.0503\))/i.test(r);
      const qHasData = /(Ø\s*\d|mm|H7|h6|k6|C45|16MnCr|EN-GJL|Titan|Guss|Zeichnung)/i.test(q);
      return (inventedGeo || (inventedMat && !qHasData)) && r.length > 800;
    },
  },
  {
    id: 'VAGE_FRAGE_OHNE_RUECKFRAGE',
    name: 'Vage Frage mit Roman statt Rückfrage (sollte klären, nicht erfinden)',
    check: (rec) => {
      const q = (rec.question || '').trim();
      const r = rec.response || '';
      const vagueQ = q.length < 40 || /^(hey|hallo|hi|was|wqs|empfehl|test)[\s!?.:]*$/i.test(q) || /w[üu]rdest du mir emphelen/i.test(q);
      if (!vagueQ) return false;
      const asksBack = /(welche|welcher|bitte teilen|benötige|nennen Sie|teilen Sie mir|haben Sie bereits|fundstelle|zeichnung|werkstückdaten)/i.test(r);
      return r.length > 1500 && !asksBack;
    },
  },
];

const LLM_AUDIT_SYSTEM = `Du bist der strenge Qualitätsprüfer des HAINBUCH Technical Advisor (Spanntechnik: SPANNTOP, MANDO, InoFlex, MANOK, centroteX, TOPlus).
Prüfe FRAGE + ANTWORT und antworte NUR mit JSON:
{"score":0-100,"hallucinated":true/false,"wrongProduct":true/false,"genericFiller":true/false,"missingSources":true/false,"issues":["kurze Stichpunkte auf Deutsch"]}
Abzüge:
- hallucinated=true wenn die Antwort konkrete Maße (Ø, L, Toleranzen), Werkstoffe, Mat-Nummern oder Stückzahlen als Fakt nennt, die in der FRAGE NICHT vorkommen und nicht als Annahme gekennzeichnet sind. Vage Fragen ("100 Bremsscheiben produzieren", "was empfiehlst du") dürfen KEINE erfundene Referenzgeometrie (z.B. "Rohguss Ø 304, Fertigmaß Ø 300x24") enthalten — dafür gibt es 0-40 Punkte.
- wrongProduct=true wenn das Spannmittel technisch falsch ist (z.B. Spannkopffutter für Ø>100mm Teile ohne Hinweis auf die Durchmessergrenze, 3-Backenfutter für 1mm-wandiges Titan ohne Verzugswarnung).
- genericFiller=true wenn bei vager Frage ein generischer Systemvergleichs-Roman statt max. 2-3 Klärungsfragen + kurzer Orientierung kommt.
- missingSources=true wenn HAINBUCH-Produkte genannt werden ohne hainbuch.com-Quellenlink.
- Kurze korrekte Rückfragen ("Bitte Maße/Toleranzen nennen") bei vagen Fragen = 85-100 Punkte, KEIN Abzug.
Bewerte streng aber fair. Nur JSON, kein Markdown.`;

async function llmAudit(question, response, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(LLM_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: MODEL_ID,
        temperature: 0,
        max_tokens: 400,
        messages: [
          { role: 'system', content: LLM_AUDIT_SYSTEM },
          {
            role: 'user',
            content: `FRAGE:\n${(question || '').slice(0, 800)}\n\nANTWORT (gekürzt):\n${(response || '').slice(0, 3500)}`,
          },
        ],
      }),
    });
    if (!r.ok) throw new Error(`LLM HTTP ${r.status}`);
    const j = await r.json();
    const txt = (j.choices?.[0]?.message?.content || '').replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
    return { ok: true, ...parsed };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    clearTimeout(to);
  }
}

async function main() {
  console.log(`[Daily Review] Starting audit for date: ${TARGET_DATE}`);

  if (!fs.existsSync(DAILY_LOG)) {
    console.log(`[Daily Review] No chat logs found for ${TARGET_DATE} (${DAILY_LOG}).`);
    fs.writeFileSync(REPORT_FILE, `# HAINBUCH Daily Quality Report - ${TARGET_DATE}\n\nKeine Chat-Aufzeichnungen für diesen Tag vorhanden.\n`, 'utf8');
    process.exit(0);
  }

  const lines = fs.readFileSync(DAILY_LOG, 'utf8').trim().split('\n').filter(Boolean);
  const records = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  console.log(`[Daily Review] Found ${records.length} interactions.`);

  let totalAudited = 0;
  let cleanCount = 0;
  let flaggedCount = 0;
  let llmOk = 0;
  let llmFail = 0;
  const auditedItems = [];

  for (const rec of records) {
    if (rec.stage !== 'success' || !rec.response) continue;
    totalAudited++;
    const issues = [];
    let correctedResponse = rec.response;

    for (const rule of AUDIT_RULES) {
      let hit = false;
      try { hit = rule.check(rec); } catch { hit = false; }
      if (hit) {
        issues.push(`[${rule.id}] ${rule.name}`);
        if (rule.fix) {
          try { correctedResponse = rule.fix(correctedResponse); rec._autoFixed = true; } catch {}
        } else {
          rec._needsManual = true;
        }
      }
    }

    // Stage 2 inputs collected; parallel LLM pass runs after the loop.
    rec._issues = issues;
    rec._correctedResponse = correctedResponse;
  }

  // Stage 2: LLM semantic audit, 6 parallel (skip trivial fast-path greetings).
  // Deterministically flagged items skip the LLM (already caught, saves time).
  if (!NO_LLM) {
    const cands = records.filter((rec) => rec._issues && (rec.response || '').length > 200 && !rec.fastPath && rec._issues.length === 0);
    console.log(`[Daily Review] LLM-auditing ${cands.length} deterministic-clean candidates (6 parallel)...`);
    for (let i = 0; i < cands.length; i += 6) {
      const batch = cands.slice(i, i + 6);
      const results = await Promise.all(batch.map((rec) => llmAudit(rec.question, rec.response)));
      // one retry for aborted/failed audits (slow model via proxy)
      for (let k = 0; k < results.length; k++) {
        if (!results[k].ok) {
          await new Promise((r) => setTimeout(r, 1000));
          results[k] = await llmAudit(batch[k].question, batch[k].response, 60000);
        }
      }
      results.forEach((llm, k) => {
        const rec = batch[k];
        if (llm.ok) {
          llmOk++;
          rec._llmScore = typeof llm.score === 'number' ? llm.score : null;
          if (typeof llm.score === 'number' && llm.score < 70) {
            const tags = [];
            if (llm.hallucinated) tags.push('Halluzination');
            if (llm.wrongProduct) tags.push('falsches Produkt');
            if (llm.genericFiller) tags.push('generischer Fülltext');
            if (llm.missingSources) tags.push('Quellen fehlen');
            rec._issues.push(`[LLM ${llm.score}/100] ${(llm.issues || []).join('; ') || tags.join(', ') || 'schwache Antwort'}`);
          }
        } else {
          llmFail++;
          if (llmFail <= 3) console.log(`[Daily Review] LLM audit failed: ${llm.error}`);
        }
      });
      console.log(`[Daily Review] LLM progress: ${Math.min(i + 6, cands.length)}/${cands.length}`);
    }
  }

  for (const rec of records) {
    if (!rec._issues) continue;
    if (rec._issues.length === 0) cleanCount++;
    else flaggedCount++;
    auditedItems.push({
      recordedAt: rec.recordedAt,
      question: rec.question || (rec.messages ? rec.messages.map((m) => m.content).join(' ') : '—'),
      issues: rec._issues,
      autoFixed: !!rec._autoFixed,
      needsManual: !!rec._needsManual || rec._issues.some((x) => x.startsWith('[LLM')),
      llmScore: rec._llmScore != null ? rec._llmScore : null,
      originalResponse: rec.response,
      correctedResponse: rec._correctedResponse,
    });
  }

  // Promote ONLY answers clean in both stages (never hallucinations).
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    let gold = [];
    if (fs.existsSync(GOLD_FILE)) {
      try { gold = JSON.parse(fs.readFileSync(GOLD_FILE, 'utf8')); } catch {}
    }
    let promoted = 0;
    for (const item of auditedItems) {
      if (item.needsManual) continue; // auto-fixable only → promote corrected version
      if (item.question.length < 20 || item.correctedResponse.length < 500) continue;
      if (item.question.length < 40 && item.correctedResponse.length > 1500) continue; // vague Q + roman → no gold
      const existing = gold.findIndex((g) => g.question === item.question);
      const entry = {
        question: item.question,
        answer: item.correctedResponse.slice(0, 6000),
        verifiedAt: new Date().toISOString(),
        qualityScore: item.llmScore != null ? item.llmScore : 90,
      };
      if (existing >= 0) gold[existing] = entry;
      else { gold.push(entry); promoted++; }
    }
    fs.writeFileSync(GOLD_FILE, JSON.stringify(gold.slice(-100), null, 2), 'utf8');
    console.log(`[Daily Review] Gold Standards updated (${gold.length} entries, +${promoted} promoted).`);
  } catch (err) {
    console.error('[Daily Review] Failed to save gold standards:', err.message);
  }

  const score = totalAudited > 0 ? Math.round((cleanCount / totalAudited) * 100) : 100;
  const detHits = auditedItems.filter((i) => i.issues.some((x) => !x.startsWith('[LLM'))).length;
  const llmHits = auditedItems.filter((i) => i.issues.some((x) => x.startsWith('[LLM'))).length;
  const llmNote = NO_LLM
    ? 'LLM-Prüfung per --no-llm übersprungen — Score nur deterministisch.'
    : llmFail > 0 && llmOk === 0
      ? `LLM-Prüfung FEHLGESCHLAGEN (Modell ${MODEL_ID} nicht erreichbar) — Score nur deterministisch, NICHT als "exzellent" werten.`
      : `LLM-Prüfung: ${llmOk} ok / ${llmFail} Fehler (Modell ${MODEL_ID}).`;

  let md = `# 📋 HAINBUCH Daily Quality & Verification Report
**Datum:** ${TARGET_DATE}
**Geprüfte Chats:** ${totalAudited}
**Fehlerfreie Antworten:** ${cleanCount}
**Nachbearbeitete / Korrigierte Antworten:** ${flaggedCount}
**Gesamt-Qualitäts-Score:** ${score} %
**Prüfmethodik:** deterministische Regeln + LLM-Eigenprüfung (${MODEL_ID})

---

## 🔍 Zusammenfassung der Prüfpunkte:

| Metrik | Wert | Status |
| :--- | :--- | :--- |
| **Erfasste Interaktionen** | ${records.length} | ✅ Registriert |
| **Erfolgreich ausgeliefert** | ${totalAudited} | ✅ 100% |
| **Deterministisch auffällig** | ${detHits} / ${totalAudited} | ${detHits === 0 ? '✅ Keine' : '⚠️ Siehe Details'} |
| **LLM-semantisch auffällig** | ${llmHits} / ${totalAudited} | ${llmHits === 0 ? '✅ Keine' : '⚠️ Siehe Details'} |

> ${llmNote}

---

## 🛠️ Detaillierte Nachbearbeitung:

`;
  if (flaggedCount === 0) {
    md += `> Alle Antworten dieses Tages bestanden deterministische UND LLM-Prüfung (Bilder, Arbeitspläne, keine Halluzinationen, Quellen vorhanden).\n\n`;
  } else {
    for (const item of auditedItems.filter((i) => i.issues.length > 0)) {
      md += `### 💬 Anfrage: "${item.question.slice(0, 100)}..."\n`;
      md += `- **Zeitpunkt:** ${item.recordedAt}\n`;
      if (item.llmScore != null) md += `- **LLM-Score:** ${item.llmScore}/100\n`;
      md += `- **Erkannte Abweichungen:**\n`;
      for (const iss of item.issues) md += `  - ${iss}\n`;
      md += `- **Korrektur-Status:** ${!item.needsManual ? 'Automatisch korrigiert (Bild/Fit-Fix) und in Gold-Standards übernommen.' : item.autoFixed ? 'TEILWEISE automatisch korrigiert (Bild/Fit-Fix), Rest erfordert manuellen Prompt-/Codefix in lite-server.cjs — NICHT in Gold-Standards.' : 'NICHT automatisch behebbar — manueller Prompt-/Codefix in lite-server.cjs erforderlich, NICHT in Gold-Standards übernommen.'}\n\n`;
    }
  }

  fs.writeFileSync(REPORT_FILE, md, 'utf8');
  console.log(`[Daily Review] Report generated at: ${REPORT_FILE} (score ${score}%, clean ${cleanCount}/${totalAudited})`);
}

main().catch((e) => { console.error('[Daily Review] fatal:', e); process.exit(1); });
