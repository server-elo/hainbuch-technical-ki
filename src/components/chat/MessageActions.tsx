import React, { useState } from 'react';
import { FileDown, ThumbsUp, ThumbsDown, Copy, Check } from 'lucide-react';
import type { ChatMessage } from '../../types';
import { T } from '../../i18n';
import { API_BASE, apiHeaders } from '../../config';
import { num, eur } from '../../format';

export const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export const nl2br = (s: string) => esc(s).replace(/\n/g, '<br>');

/** Flatten a model message (text + structured analysis) to plain text for the clipboard. */
export function messageToText(msg: ChatMessage, t: (typeof T)[keyof typeof T]): string {
  const out: string[] = [];
  for (const part of msg.parts) if (part.text) out.push(part.text);
  const a = msg.analysis;
  if (a?.manufacturingAnalysis) {
    const ma = a.manufacturingAnalysis;
    if (ma.material) {
      out.push(`\n${t.material}: ${ma.material.name}\n${ma.material.reasoning}`);
      if (ma.rawMaterialRecommendation) out.push(`${t.rawMaterial}: ${ma.rawMaterialRecommendation}`);
    }
    out.push(`${t.fastest}: ${ma.fastestMethod}`);
    out.push(`${t.economic}: ${ma.costEffectiveMethod}`);
    if (ma.clampingStrategy) out.push(`${t.clamping}: ${ma.clampingStrategy}`);
    if (Array.isArray(ma.operations) && ma.operations.length > 0) {
      out.push(`\n${t.plan}:`);
      ma.operations.forEach((op, i) => {
        let line = `${String((i + 1) * 10).padStart(3, '0')}  ${op.stepName} — ${op.tool} — ${op.time}`;
        if (op.spindleSpeedRpm !== undefined) {
          line += `\n     n = ${num(op.spindleSpeedRpm, 'de', 0)} 1/min, vc = ${num(op.vc, 'de')} m/min, f = ${num(op.feed, 'de', 3)} ${op.feedUnit}, vf = ${num(op.feedRateMmPerMin, 'de', 0)} mm/min`;
        }
        out.push(line);
      });
      out.push(`${t.total}: ${ma.totalEstimatedMachiningTime}`);
    }
  }
  if (a?.clampingCheck) {
    const ck = a.clampingCheck;
    out.push(`\n${t.clampCheck} (erforderlich ≈ ${num(ck.requiredClampForceKn, 'de', 1)} kN):`);
    ck.products.forEach(p =>
      out.push(`- ${p.product}: ${p.catalogForceKn !== null ? `${num(p.catalogForceKn, 'de', 1)} kN → ${p.verdict}` : 'keine Katalog-Spannkraft'}`)
    );
    out.push(ck.note);
  }
  if (a?.costComparison) {
    const cc = a.costComparison;
    out.push(`\n${t.costCompare} (${num(cc.batchSize, 'de', 0)} Stk, ${num(cc.hourlyRateEur, 'de', 0)} €/h):`);
    cc.alternatives.forEach(alt =>
      out.push(`- ${alt.product} (${alt.actuation}): ${num(alt.clampMinPerPart, 'de')} min/Teil, ${num(alt.handlingMinSeries, 'de')} min Serie, ${eur(alt.handlingCostSeriesEur, 'de')}${alt.extraVsBestEur > 0 ? ` (+${eur(alt.extraVsBestEur, 'de')})` : ''}`)
    );
    out.push(cc.note);
  }
  if (a?.ecosystem?.length) {
    out.push('\nDas passende Komplettpaket:');
    a.ecosystem.forEach(e => {
      out.push(`- ${e.category}: ${e.suggestion} (${e.reason})`);
      e.products?.forEach(p => out.push(`    ${p.name} · Mat.-Nr. ${p.materialNo}`));
    });
    if (a.salesNudge) out.push(a.salesNudge);
  }
  if (a?.recommendations) {
    a.recommendations.forEach((rec, i) => {
      out.push(`\n${t.recommendation} ${i + 1}: ${rec.product}\n${rec.description}`);
      if (rec.pros?.length) out.push(`${t.pros}:\n${rec.pros.map(p => `+ ${p}`).join('\n')}`);
      if (rec.cons?.length) out.push(`${t.cons}:\n${rec.cons.map(c => `- ${c}`).join('\n')}`);
      if (rec.technicalData) out.push(rec.technicalData);
    });
  }
  return out.join('\n');
}

/** Standalone A4 print view of one answer — browser print dialog → PDF. */
export function buildPrintHtml(msg: ChatMessage, t: (typeof T)[keyof typeof T]): string {
  const a = msg.analysis;
  const ma = a?.manufacturingAnalysis;
  const text = msg.parts.map(p => p.text || '').filter(Boolean).join('\n');
  const card = (title: string, body: string) =>
    `<div class="card"><div class="label">${esc(title)}</div>${body}</div>`;
  let body = `<p class="msg">${nl2br(text)}</p>`;
  if (ma?.material) {
    body += card(t.material, `<b>${esc(ma.material.name)}</b><p>${nl2br(ma.material.reasoning)}</p>` +
      (ma.rawMaterialRecommendation ? `<p><b>${esc(t.rawMaterial)}:</b> ${esc(ma.rawMaterialRecommendation)}</p>` : ''));
  }
  if (ma) {
    body += `<div class="two">${card(t.fastest, `<p>${nl2br(ma.fastestMethod)}</p>`)}${card(t.economic, `<p>${nl2br(ma.costEffectiveMethod)}</p>`)}</div>`;
    if (ma.clampingStrategy) body += card(t.clamping, `<p>${nl2br(ma.clampingStrategy)}</p>`);
    if (Array.isArray(ma.operations) && ma.operations.length > 0) {
      const rows = ma.operations.map((op, i) =>
        `<tr><td>${String((i + 1) * 10).padStart(3, '0')}</td><td>${esc(op.stepName)}<br><span class="dim">${esc(op.tool)}</span>` +
        (op.spindleSpeedRpm !== undefined
          ? `<br><span class="dim">n = ${num(op.spindleSpeedRpm, 'de', 0)} 1/min · vc = ${num(op.vc, 'de')} m/min · f = ${num(op.feed, 'de', 3)} ${esc(op.feedUnit || '')} · vf = ${num(op.feedRateMmPerMin, 'de', 0)} mm/min</span>`
          : '') +
        `</td><td class="right">${esc(op.time)}</td></tr>`).join('');
      body += card(t.plan,
        `<table><thead><tr><th>OP</th><th></th><th class="right">t</th></tr></thead><tbody>${rows}</tbody>` +
        `<tfoot><tr><td></td><td><b>${esc(t.total)}</b></td><td class="right"><b>${esc(ma.totalEstimatedMachiningTime)}</b></td></tr></tfoot></table>`);

      const firstUse = new Map<string, { tNo: number; opName: string }>();
      ma.operations.forEach((op, i) => {
        if (!firstUse.has(op.tool)) firstUse.set(op.tool, { tNo: i + 1, opName: `OP ${String((i + 1) * 10).padStart(3, '0')} ${op.stepName}` });
      });
      const toolRows = [...firstUse.entries()].map(([tool, v]) =>
        `<tr><td>T${v.tNo}</td><td>${esc(tool)}</td><td>${esc(v.opName)}</td></tr>`).join('');
      const clampingProduct = a?.recommendations?.[0]?.product;
      body += card(t.setupSheet,
        `<table><thead><tr><th>T</th><th>${esc(t.setupTool)}</th><th>${esc(t.setupFirstOp)}</th></tr></thead><tbody>${toolRows}</tbody></table>` +
        (clampingProduct ? `<p><b>${esc(t.setupClamping)}:</b> ${esc(clampingProduct)}</p>` : ''));
    }
  }
  if (a?.clampingCheck) {
    const ck = a.clampingCheck;
    const rows = ck.products.map(p => {
      const sym = p.verdict === 'passt' ? '🟢' : p.verdict === 'knapp' ? '🟡' : p.verdict === 'zu klein' ? '🔴' : '⚪';
      return `<tr><td>${sym} ${esc(p.product)}</td><td class="right">${p.catalogForceKn !== null ? num(p.catalogForceKn, 'de', 1) + ' kN' : '—'}</td><td class="right"><b>${esc(p.verdict)}</b></td></tr>`;
    }).join('');
    body += card(`${t.clampCheck} · erforderlich ≈ ${num(ck.requiredClampForceKn, 'de', 1)} kN`,
      `<table><tbody>${rows}</tbody></table><p class="dim">${esc(ck.note)}</p>`);
  }
  if (a?.costComparison) {
    const cc = a.costComparison;
    const rows = cc.alternatives.map(alt =>
      `<tr><td>${esc(alt.product)} <span class="dim">· ${esc(alt.actuation)}</span></td>` +
      `<td class="right">${num(alt.clampMinPerPart, 'de')} min</td><td class="right">${num(alt.handlingMinSeries, 'de')} min</td>` +
      `<td class="right"><b>${eur(alt.handlingCostSeriesEur, 'de')}${alt.extraVsBestEur > 0 ? ` (+${num(alt.extraVsBestEur, 'de')})` : ''}</b></td></tr>`).join('');
    body += card(`${t.costCompare} · ${num(cc.batchSize, 'de', 0)} Stk · ${num(cc.hourlyRateEur, 'de', 0)} €/h`,
      `<table><thead><tr><th></th><th class="right">${esc(t.perPart)}</th><th class="right">${esc(t.perSeries)}</th><th class="right">€</th></tr></thead><tbody>${rows}</tbody></table>` +
      `<p class="dim">${esc(cc.note)}</p>`);
  }
  if (a?.ecosystem?.length) {
    const rows = a.ecosystem.map(e =>
      `<tr><td><b>${esc(e.category)}</b><br><span class="dim">${esc(e.reason)}</span></td>` +
      `<td>${esc(e.suggestion)}` +
      (e.products?.length
        ? `<br>${e.products.map(p => `<span class="dim">${esc(p.name)} · Mat.-Nr. ${esc(p.materialNo)}</span>`).join('<br>')}`
        : '') +
      `</td></tr>`).join('');
    body += card('Das passende Komplettpaket',
      `<table><tbody>${rows}</tbody></table>` +
      (a.salesNudge ? `<p class="dim">${esc(a.salesNudge)}</p>` : ''));
  }
  for (const [i, rec] of (a?.recommendations || []).entries()) {
    body += card(`${t.recommendation} ${i + 1}`,
      (rec.imageUrl ? `<img class="prod" src="${API_BASE}${rec.imageUrl}">` : '') +
      `<b>${esc(rec.product)}</b><p>${nl2br(rec.description)}</p>` +
      (rec.pros?.length ? `<p class="pros">${rec.pros.map(p => '+ ' + esc(p)).join('<br>')}</p>` : '') +
      (rec.cons?.length ? `<p class="cons">${rec.cons.map(c => '– ' + esc(c)).join('<br>')}</p>` : '') +
      (rec.technicalData ? `<pre>${esc(rec.technicalData)}</pre>` : ''));
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>HAINBUCH Technical Advisor</title><style>
    body{font-family:Inter,-apple-system,Helvetica,Arial,sans-serif;color:#262626;font-size:11px;line-height:1.5;margin:24px}
    .head{display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid #d40511;padding-bottom:8px;margin-bottom:14px}
    .brand{color:#d40511;font-weight:900;font-size:20px;letter-spacing:-0.5px}
    .card{border:1px solid #e5e5e5;border-radius:6px;padding:10px 12px;margin:10px 0;page-break-inside:avoid}
    .label{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#d40511;margin-bottom:4px}
    .two{display:flex;gap:10px}.two .card{flex:1;margin:10px 0 0}
    table{width:100%;border-collapse:collapse}td,th{padding:4px 6px;border-bottom:1px solid #f0f0f0;text-align:left;vertical-align:top}
    .right{text-align:right;white-space:nowrap}.dim{color:#888;font-size:10px}
    .pros{color:#15803d;margin:6px 0 0}.cons{color:#b91c1c;margin:4px 0 0}
    pre{background:#fafafa;border:1px solid #eee;border-radius:4px;padding:8px;font-size:10px;white-space:pre-wrap}
    .prod{float:right;max-width:140px;max-height:110px;object-fit:contain;margin-left:10px}
    .msg{white-space:normal}
    .foot{margin-top:16px;color:#999;font-size:9px;border-top:1px solid #eee;padding-top:6px}
    @page{margin:14mm}
  </style></head><body>
    <div class="head"><span class="brand">HAINBUCH</span><span>Technical Advisor · ${new Date().toLocaleDateString('de-DE')}</span></div>
    ${body}
    <div class="foot">Automatisch erstellte Analyse — Richtwerte ohne Gewähr. Verbindliche Angaben nur über das offizielle HAINBUCH-Angebot.</div>
  </body></html>`;
}

export function PdfButton({ msg, t }: { msg: ChatMessage; t: (typeof T)[keyof typeof T] }) {
  const openPrint = () => {
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(buildPrintHtml(msg, t));
    w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 700);
  };
  return (
    <button
      onClick={openPrint}
      title="PDF"
      className="tap flex items-center gap-1 text-[11px] text-neutral-400 hover:text-red-600 transition-colors"
    >
      <FileDown size={12} />
      PDF
    </button>
  );
}

export function FeedbackButtons({ getText, conversationId }: { getText: () => string; conversationId?: string | null }) {
  const [sent, setSent] = useState<'up' | 'down' | null>(null);
  const send = (rating: 'up' | 'down') => {
    if (sent) return;
    setSent(rating);
    fetch(`${API_BASE}/api/feedback`, {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ rating, message: getText().slice(0, 2000), conversationId: conversationId || undefined }),
    }).catch(() => { /* feedback is best-effort */ });
  };
  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={() => send('up')}
        aria-label="+1"
        className={`tap transition-colors ${sent === 'up' ? 'text-green-600' : sent ? 'text-neutral-200' : 'text-neutral-400 hover:text-green-600'}`}
      >
        <ThumbsUp size={12} />
      </button>
      <button
        onClick={() => send('down')}
        aria-label="-1"
        className={`tap transition-colors ${sent === 'down' ? 'text-red-600' : sent ? 'text-neutral-200' : 'text-neutral-400 hover:text-red-600'}`}
      >
        <ThumbsDown size={12} />
      </button>
    </div>
  );
}

export function CopyButton({ getText, labels }: { getText: () => string; labels: { copy: string; copied: string } }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const text = getText();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={copy}
      className="tap flex items-center gap-1 text-[11px] text-neutral-400 hover:text-red-600 transition-colors"
      title={labels.copy}
    >
      {copied ? <Check size={12} className="text-green-600" /> : <Copy size={12} />}
      {copied ? labels.copied : ''}
    </button>
  );
}
