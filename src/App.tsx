import React, { useState, useRef, useEffect } from 'react';
import {
  Send, User, ChevronRight, ChevronDown, Loader2, FileText,
  Image as ImageIcon, Paperclip, X, Clock, TrendingDown, Copy, Check,
  ThumbsUp, ThumbsDown, FileDown, ArrowDown, PenLine
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { ChatMessage, PipelineStatus } from './types';
import WaitingPanel, { FactCarousel } from './components/WaitingPanel';
import { T, type UiLang } from './i18n';
import { API_BASE, apiHeaders } from './config';
import { num, eur } from './format';
import OperationsChart from './components/OperationsChart';
import FitDiagram from './components/FitDiagram';

/** HAINBUCH collet mark — three jaws around a bore. Same geometry as the app icon. */
function ColletMark({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} aria-hidden="true">
      <defs>
        <clipPath id="cm-slots">
          <path
            d="M0 0h64v64H0z M32 32 L36.4 -17.8 L27.6 -17.8 Z M32 32 L-13.3 53.1 L-9.0 60.7 Z M32 32 L73.0 60.7 L77.3 53.1 Z"
            clipRule="evenodd"
          />
        </clipPath>
      </defs>
      <g clipPath="url(#cm-slots)">
        <circle cx="32" cy="32" r="19" fill="none" stroke="currentColor" strokeWidth="7" />
      </g>
      <circle cx="32" cy="32" r="7.5" fill="currentColor" />
    </svg>
  );
}

/** Pipeline stages the i18n stage list covers (same order as t.stages). */
const STAGE_INDEX: Record<string, number> = {
  'retrieval-material': 0,
  material: 1,
  'retrieval-catalog': 2,
  plan: 3,
  calc: 4,
};

function stageLabelFor(stage: string, t: (typeof T)[keyof typeof T]): string {
  const idx = STAGE_INDEX[stage];
  return idx !== undefined ? t.stages[idx] : t.analyzing;
}

/** ChatGPT-style collapsible "thinking" indicator with scrolling event log. */
function ThinkingIndicator({ pipeline, fallback }: { pipeline: PipelineStatus; fallback: string }) {
  const [open, setOpen] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [pipeline.log.length, open]);

  const latest = pipeline.log[pipeline.log.length - 1] || fallback;

  return (
    <div className="max-w-[85%]">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-neutral-400 hover:text-neutral-600 transition-colors group"
      >
        <Loader2 size={11} className="animate-spin text-red-600 shrink-0" />
        <span className="text-[10px] font-medium animate-pulse">
          {open ? fallback : latest}
        </span>
        <ChevronRight
          size={10}
          className={`shrink-0 transition-transform text-neutral-300 group-hover:text-neutral-500 ${open ? 'rotate-90' : ''}`}
        />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div
              ref={logRef}
              className="mt-1.5 ml-4 pl-3 border-l-2 border-neutral-200 max-h-32 overflow-y-auto space-y-1"
            >
              {pipeline.log.map((line, i) => (
                <p
                  key={i}
                  className={`text-[10px] leading-relaxed ${
                    i === pipeline.log.length - 1 ? 'text-neutral-500' : 'text-neutral-400'
                  }`}
                >
                  {line}
                </p>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Minimal markdown renderer for assistant messages (###, **bold**, bullets). */
function MessageText({ text }: { text: string }) {
  const renderInline = (s: string) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith('**') && part.endsWith('**') ? (
        <strong key={i} className="font-semibold text-neutral-900">{part.slice(2, -2)}</strong>
      ) : (
        part
      )
    );

  return (
    <div className="text-sm leading-relaxed space-y-1.5">
      {text.split('\n').map((line, i) => {
        const t = line.trim();
        if (!t) return <div key={i} className="h-1" />;
        if (t.startsWith('###')) {
          return (
            <p key={i} className="font-semibold text-neutral-900 mt-2">
              {t.replace(/^#+\s*/, '')}
            </p>
          );
        }
        if (/^[-•]\s/.test(t)) {
          return (
            <p key={i} className="pl-4 relative">
              <span className="absolute left-1 text-red-600">•</span>
              {renderInline(t.replace(/^[-•]\s/, ''))}
            </p>
          );
        }
        return <p key={i}>{renderInline(line)}</p>;
      })}
    </div>
  );
}

/** Flatten a model message (text + structured analysis) to plain text for the clipboard. */
function messageToText(msg: ChatMessage, t: (typeof T)[keyof typeof T]): string {
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

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const nl2br = (s: string) => esc(s).replace(/\n/g, '<br>');

/** Standalone A4 print view of one answer — browser print dialog → PDF. */
function buildPrintHtml(msg: ChatMessage, t: (typeof T)[keyof typeof T]): string {
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

      // Einrichteblatt — Werkzeugliste (T-Nr. = Reihenfolge im Plan,
      // wie im Fachkunde-Beispiel), Spannmittel aus der ersten Empfehlung.
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

function PdfButton({ msg, t }: { msg: ChatMessage; t: (typeof T)[keyof typeof T] }) {
  const openPrint = () => {
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(buildPrintHtml(msg, t));
    w.document.close();
    // give product images a moment to load before the print dialog
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

function FeedbackButtons({ getText }: { getText: () => string }) {
  const [sent, setSent] = useState<'up' | 'down' | null>(null);
  const send = (rating: 'up' | 'down') => {
    if (sent) return;
    setSent(rating);
    fetch(`${API_BASE}/api/feedback`, {
      method: 'POST',
      headers: apiHeaders(),
      body: JSON.stringify({ rating, message: getText().slice(0, 2000) }),
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

function CopyButton({ getText, labels }: { getText: () => string; labels: { copy: string; copied: string } }) {
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

/** Structured pipeline result (fits, plan, cutting data, products) shown under the message. */
function AnalysisBlock({ analysis, t, lang }: { analysis: NonNullable<ChatMessage['analysis']>; t: (typeof T)[keyof typeof T]; lang: UiLang }) {
  const ma = analysis.manufacturingAnalysis;
  const recs = analysis.recommendations;
  const fits = analysis.fitSolutions;
  return (
    <div className="mt-3 space-y-3">
      {fits && fits.length > 0 && fits.map((fit, i) => <FitDiagram key={i} fit={fit} />)}

      {ma && (
        <>
          {ma.material && (
            <div className="border border-neutral-200 rounded-lg p-4 bg-white">
              <h4 className="text-[11px] text-red-600 font-semibold uppercase tracking-wider mb-1">{t.material}</h4>
              <p className="text-sm text-neutral-900 font-semibold">{ma.material.name}</p>
              <p className="text-xs text-neutral-500 mt-1 leading-relaxed">{ma.material.reasoning}</p>
              {ma.rawMaterialRecommendation && (
                <p className="text-xs text-neutral-600 mt-2">
                  <span className="font-medium">{t.rawMaterial}:</span> {ma.rawMaterialRecommendation}
                </p>
              )}
            </div>
          )}

          <div className="grid sm:grid-cols-2 gap-3">
            <div className="border border-neutral-200 rounded-lg p-4 bg-white">
              <h4 className="text-[11px] text-neutral-400 font-semibold uppercase tracking-wider mb-1 flex items-center gap-1.5"><Clock size={11} /> {t.fastest}</h4>
              <p className="text-xs text-neutral-600 leading-relaxed">{ma.fastestMethod}</p>
            </div>
            <div className="border border-neutral-200 rounded-lg p-4 bg-white">
              <h4 className="text-[11px] text-neutral-400 font-semibold uppercase tracking-wider mb-1 flex items-center gap-1.5"><TrendingDown size={11} /> {t.economic}</h4>
              <p className="text-xs text-neutral-600 leading-relaxed">{ma.costEffectiveMethod}</p>
            </div>
          </div>

          {ma.clampingStrategy && (
            <div className="border border-neutral-200 rounded-lg p-4 bg-white">
              <h4 className="text-[11px] text-neutral-400 font-semibold uppercase tracking-wider mb-1">{t.clamping}</h4>
              <p className="text-xs text-neutral-600 leading-relaxed">{ma.clampingStrategy}</p>
            </div>
          )}

          {Array.isArray(ma.operations) && ma.operations.length > 1 && (
            <OperationsChart operations={ma.operations} title={t.timeChart} />
          )}

          {Array.isArray(ma.operations) && ma.operations.length > 0 && (
          <div className="border border-neutral-200 rounded-lg p-4 bg-white">
            <h4 className="text-[11px] text-neutral-400 font-semibold uppercase tracking-wider mb-3">{t.plan}</h4>
            <div className="space-y-3">
              {ma.operations.map((op, i) => (
                <div key={i} className="flex flex-col gap-0.5 border-b border-neutral-100 pb-2.5 last:border-0 last:pb-0">
                  <div className="flex justify-between items-start gap-2">
                    <span className="font-medium text-neutral-800 text-[13px]">
                      <span className="text-neutral-400 font-mono text-[10px] mr-1.5">{String((i + 1) * 10).padStart(3, '0')}</span>
                      {op.stepName}
                    </span>
                    <span className="text-red-600 font-mono text-xs font-medium shrink-0">{op.time}</span>
                  </div>
                  <span className="text-[11px] text-neutral-500">{op.tool}</span>
                  {op.spindleSpeedRpm !== undefined && (
                    <span className="text-[11px] text-neutral-400 font-mono break-words">
                      n = {num(op.spindleSpeedRpm, lang, 0)} 1/min · vc = {num(op.vc, lang)} m/min · f = {num(op.feed, lang, 3)} {op.feedUnit} · vf = {num(op.feedRateMmPerMin, lang, 0)} mm/min
                    </span>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-3 pt-3 border-t border-neutral-200 flex justify-between items-center gap-4">
              <span className="text-[11px] text-neutral-500 font-semibold uppercase tracking-wider shrink-0">{t.total}</span>
              <span className="text-sm font-mono text-red-600 font-semibold text-right">{ma.totalEstimatedMachiningTime}</span>
            </div>
          </div>
          )}
        </>
      )}

      {analysis.clampingCheck && (
        <div className="border border-neutral-200 rounded-lg p-4 bg-white">
          <h4 className="text-[11px] text-red-600 font-semibold uppercase tracking-wider mb-2">
            {t.clampCheck} · erforderlich ≈ {num(analysis.clampingCheck.requiredClampForceKn, lang, 1)} kN
          </h4>
          <div className="space-y-1.5">
            {analysis.clampingCheck.products.map((p, i) => {
              const color =
                p.verdict === 'passt' ? 'bg-green-500' :
                p.verdict === 'knapp' ? 'bg-yellow-400' :
                p.verdict === 'zu klein' ? 'bg-red-500' : 'bg-neutral-300';
              return (
                <div key={i} className="flex items-center justify-between gap-2 text-[12px]">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${color}`} />
                    <span className="truncate font-medium text-neutral-800">{p.product}</span>
                  </span>
                  <span className="font-mono text-neutral-500 shrink-0">
                    {p.catalogForceKn !== null ? `${num(p.catalogForceKn, lang, 1)} kN · ${Math.round((p.ratio ?? 0) * 100)} %` : '—'}
                    <span className={`ml-2 font-sans font-semibold ${
                      p.verdict === 'passt' ? 'text-green-700' : p.verdict === 'knapp' ? 'text-yellow-600' : p.verdict === 'zu klein' ? 'text-red-600' : 'text-neutral-400'
                    }`}>{p.verdict}</span>
                  </span>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-neutral-400 mt-2 leading-relaxed">{analysis.clampingCheck.note}</p>
        </div>
      )}

      {analysis.costComparison && (
        <div className="border border-neutral-200 rounded-lg p-4 bg-white">
          <h4 className="text-[11px] text-red-600 font-semibold uppercase tracking-wider mb-2">
            {t.costCompare} · {num(analysis.costComparison.batchSize, lang, 0)} Stk · {num(analysis.costComparison.hourlyRateEur, lang, 0)} €/h
          </h4>
          <div className="table-scroll -mx-1 px-1">
          <table className="w-full text-[11px] text-neutral-600">
            <thead>
              <tr className="text-neutral-400">
                <th className="text-left font-medium pb-1"></th>
                <th className="text-right font-medium pb-1">{t.perPart}</th>
                <th className="text-right font-medium pb-1">{t.perSeries}</th>
                <th className="text-right font-medium pb-1">€</th>
              </tr>
            </thead>
            <tbody>
              {analysis.costComparison.alternatives.map((a, i) => (
                <tr key={i} className="border-t border-neutral-100">
                  <td className="py-1.5 font-medium text-neutral-800">
                    {a.product}
                    <span className="text-neutral-400 font-normal"> · {a.actuation}</span>
                  </td>
                  <td className="py-1.5 text-right font-mono">{num(a.clampMinPerPart, lang)} min</td>
                  <td className="py-1.5 text-right font-mono">{num(a.handlingMinSeries, lang)} min</td>
                  <td className={`py-1.5 text-right font-mono ${a.extraVsBestEur === 0 ? 'text-green-700 font-semibold' : 'text-red-600'}`}>
                    {eur(a.handlingCostSeriesEur, lang)}{a.extraVsBestEur > 0 ? ` (+${num(a.extraVsBestEur, lang)})` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <p className="text-[10px] text-neutral-400 mt-2 leading-relaxed">{analysis.costComparison.note}</p>
        </div>
      )}

      {recs && recs.length > 0 && recs.map((rec, recIdx) => (
        <div key={recIdx} className="border border-neutral-200 rounded-lg overflow-hidden relative bg-white">
          {rec.imageUrl && (
            <img
              src={`${API_BASE}${rec.imageUrl}`}
              alt={rec.product}
              loading="lazy"
              className="w-full h-40 sm:h-56 lg:h-64 object-contain bg-white border-b border-neutral-100"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          )}
          <div className="p-4">
            <div className="text-[10px] font-semibold text-red-600 uppercase tracking-wider mb-1">
              {t.recommendation} {recIdx + 1}
            </div>
            <h2 className="text-base font-semibold text-neutral-900 mb-1.5">{rec.product}</h2>
            <p className="text-xs text-neutral-500 leading-relaxed">{rec.description}</p>
            {((rec.pros && rec.pros.length > 0) || (rec.cons && rec.cons.length > 0)) && (
              <div className="mt-3 grid sm:grid-cols-2 gap-2">
                {rec.pros && rec.pros.length > 0 && (
                  <div className="bg-green-50/60 border border-green-100 rounded p-2.5">
                    <p className="text-[10px] font-semibold text-green-700 uppercase tracking-wider mb-1">{t.pros}</p>
                    {rec.pros.map((p, i) => (
                      <p key={i} className="text-[11px] text-neutral-600 leading-relaxed pl-3 relative">
                        <span className="absolute left-0 text-green-600">+</span>{p}
                      </p>
                    ))}
                  </div>
                )}
                {rec.cons && rec.cons.length > 0 && (
                  <div className="bg-neutral-50 border border-neutral-200 rounded p-2.5">
                    <p className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wider mb-1">{t.cons}</p>
                    {rec.cons.map((c, i) => (
                      <p key={i} className="text-[11px] text-neutral-600 leading-relaxed pl-3 relative">
                        <span className="absolute left-0 text-red-500">–</span>{c}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
            {rec.technicalData && (
              <div className="mt-3 bg-neutral-50 border border-neutral-200 rounded p-3 text-xs text-neutral-600 whitespace-pre-wrap font-mono leading-relaxed">
                {rec.technicalData}
              </div>
            )}
          </div>
        </div>
      ))}

      {analysis.ecosystem && analysis.ecosystem.length > 0 && (
        <div className="border border-neutral-200 rounded-lg p-4 bg-white">
          <h4 className="text-[11px] text-red-600 font-semibold uppercase tracking-wider mb-2">
            Das passende Komplettpaket
          </h4>
          <div className="space-y-2">
            {analysis.ecosystem.map((e, i) => (
              <div key={i} className="text-[12px]">
                <span className="font-semibold text-neutral-800">{e.category}: </span>
                <span className="text-neutral-700">{e.suggestion}</span>
                <p className="text-[11px] text-neutral-400 leading-relaxed">{e.reason}</p>
              </div>
            ))}
          </div>
          {analysis.salesNudge && (
            <p className="text-[11px] text-neutral-600 mt-3 pt-2 border-t border-neutral-100 leading-relaxed">
              💡 {analysis.salesNudge}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function StatusDot({ onlineLabel, limitedLabel }: { onlineLabel: string; limitedLabel: string }) {
  const [online, setOnline] = useState<boolean | null>(null);
  useEffect(() => {
    const load = () =>
      fetch(`${API_BASE}/api/status`)
        .then(r => r.json())
        .then(s => setOnline(s.llmOnline && s.ragOnline))
        .catch(() => setOnline(false));
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);
  if (online === null) return null;
  return (
    <span className="hidden sm:flex items-center gap-1.5 text-xs text-neutral-500">
      <span className={`w-2 h-2 rounded-full ${online ? 'bg-green-500' : 'bg-neutral-300'}`} />
      {online ? onlineLabel : limitedLabel}
    </span>
  );
}

/** Country (via Cloudflare CF-IPCountry) → UI language.
 *  Germany/Austria/Switzerland → German, China → Chinese, further supported
 *  regions get their language, everywhere else English. */
const COUNTRY_LANG: Record<string, UiLang> = {
  DE: 'de', AT: 'de', CH: 'de', LI: 'de', LU: 'de',
  CN: 'zh', TW: 'zh', HK: 'zh', MO: 'zh', SG: 'zh',
  ES: 'es', MX: 'es', AR: 'es', CO: 'es', CL: 'es', PE: 'es',
  FR: 'fr', MC: 'fr',
  IT: 'it', SM: 'it',
  TR: 'tr',
};

export default function App() {
  // Language is automatic by IP country (Cloudflare geolocation via /api/status):
  // DACH → German, China → Chinese, other supported regions their language,
  // rest of the world English. Without a country (localhost, tunnel down)
  // the app stays German — that is the home market.
  const [uiLang, setUiLang] = useState<UiLang>('de');
  const t = T[uiLang];

  useEffect(() => {
    fetch(`${API_BASE}/api/status`)
      .then(r => r.json())
      .then(s => {
        if (s.country && COUNTRY_LANG[s.country]) setUiLang(COUNTRY_LANG[s.country]);
        else if (s.country) setUiLang('en');
      })
      .catch(() => { /* stay German */ });
  }, []);
  const [messages, setMessages] = useState<ChatMessage[]>([{
    role: "model",
    parts: [{ text: "" }]  // index 0 is always rendered from t.welcome
  }]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [pipeline, setPipeline] = useState<PipelineStatus | null>(null);
  const [showProgress, setShowProgress] = useState(false);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (atBottom) messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading, atBottom]);

  // Track whether the user has scrolled away from the latest message.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Auto-grow the composer up to the CSS max-height.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [inputValue]);

  // Consume the NDJSON pipeline stream: status events update the waiting
  // panel; the final "result" line carries the full analysis.
  const sendChat = async (newMessages: ChatMessage[]) => {
    setIsLoading(true);
    setPipeline({ stage: 'intent', label: '', infos: [], log: [], startedAt: Date.now() });
    try {
      const apiMessages = newMessages
        .filter((msg, idx) => !(idx === 0 && msg.role === 'model'))
        .map(({ role, parts }) => ({ role, parts }));
      // The latest calculated plan travels along so the server can use it
      // for follow-up questions without re-planning.
      const lastAnalysis =
        [...newMessages].reverse().find(m => m.analysis?.manufacturingAnalysis)
          ?.analysis?.manufacturingAnalysis ?? null;
      const response = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({ messages: apiMessages, lastAnalysis })
      });
      if (!response.ok || !response.body) {
        throw new Error(`Server error (${response.status})`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let result: any = null;
      let errMsg: string | null = null;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          let ev: any;
          try { ev = JSON.parse(line); } catch { continue; }
          if (ev.type === 'status') {
            // Server labels are German — translate via the stage key for other UI languages.
            const label = uiLang === 'de' ? ev.label : stageLabelFor(ev.stage, t);
            setPipeline(p => p ? { ...p, stage: ev.stage, label, log: p.log[p.log.length - 1] === label ? p.log : [...p.log, label] } : p);
          } else if (ev.type === 'info') {
            if (uiLang === 'de') {
              setPipeline(p => p ? { ...p, infos: [...p.infos, ev.label], log: [...p.log, ev.label] } : p);
            }
          } else if (ev.type === 'result') {
            result = ev.data;
          } else if (ev.type === 'error') {
            errMsg = ev.error;
          }
        }
      }
      if (errMsg) throw new Error(errMsg);
      if (!result) throw new Error('NO_RESULT');

      const hasAnalysis =
        (result.manufacturingAnalysis && typeof result.manufacturingAnalysis === 'object') ||
        (Array.isArray(result.recommendations) && result.recommendations.length > 0) ||
        (Array.isArray(result.fitSolutions) && result.fitSolutions.length > 0);
      setMessages(prev => [...prev, {
        role: 'model',
        parts: [{ text: result.message }],
        ...(hasAnalysis ? {
          analysis: {
            manufacturingAnalysis: result.manufacturingAnalysis ?? null,
            recommendations: Array.isArray(result.recommendations) ? result.recommendations : null,
            fitSolutions: Array.isArray(result.fitSolutions) ? result.fitSolutions : null,
            costComparison: result.costComparison ?? null,
            clampingCheck: result.clampingCheck ?? null,
            ecosystem: Array.isArray(result.ecosystem) ? result.ecosystem : null,
            salesNudge: result.salesNudge ?? null,
          },
        } : {}),
      }]);
    } catch (error: any) {
      console.error('Chat API Error:', error);
      setMessages(prev => [...prev, {
        role: 'model',
        parts: [{
          text: error?.message === 'NO_RESULT'
            ? `${t.errorMsg}.`
            : `${t.errorMsg} (${error.message || 'Error'}).`,
        }]
      }]);
    } finally {
      setIsLoading(false);
      setPipeline(null);
      setShowProgress(false);
    }
  };

  const convertFileToBase64 = (file: File): Promise<{base64: string, mimeType: string}> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      // DXF/PDF: raw base64, no canvas processing (parsed server-side)
      if (/\.(dxf|pdf)$/i.test(file.name)) {
        const mimeType = /\.pdf$/i.test(file.name) ? 'application/pdf' : 'application/dxf';
        reader.onloadend = () =>
          resolve({ base64: (reader.result as string).split(',')[1], mimeType });
        reader.onerror = reject;
        reader.readAsDataURL(file);
        return;
      }
      reader.onloadend = () => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX = 2048;
          let { width, height } = img;
          if (width > height && width > MAX) {
            height *= MAX / width; width = MAX;
          } else if (height > MAX) {
            width *= MAX / height; height = MAX;
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve({ base64: (reader.result as string).split(',')[1], mimeType: file.type });
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          resolve({ base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' });
        };
        img.onerror = reject;
        img.src = reader.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const submitText = async (text: string) => {
    if ((!text.trim() && !attachedFile) || isLoading) return;
    const parts: ChatMessage['parts'] = [];
    if (text.trim()) parts.push({ text });
    if (attachedFile) {
      try {
        const { base64, mimeType } = await convertFileToBase64(attachedFile);
        parts.push({ inlineData: { data: base64, mimeType } });
        if (!text.trim()) parts.push({ text: `[${t.drawingAttached}]` });
      } catch (err) {
        console.error('File attach failed:', err);
      }
    }
    if (parts.length === 0) return;
    const newMessages = [...messages, { role: 'user' as const, parts }];
    setMessages(newMessages);
    setInputValue('');
    setAttachedFile(null);
    await sendChat(newMessages);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitText(inputValue);
  };

  const resetChat = () => {
    if (isLoading) return;
    setMessages([{ role: 'model', parts: [{ text: '' }] }]);
    setInputValue('');
    setAttachedFile(null);
  };

  const acceptDrop = (f: File | undefined) => {
    if (f && /\.(dxf|pdf)$/i.test(f.name) || f?.type.startsWith('image/')) setAttachedFile(f!);
  };

  // Empty state = only the synthetic welcome message is present.
  const isEmpty = messages.length === 1;

  return (
    <div className="app-root h-[100dvh] bg-white text-neutral-800 flex flex-col overflow-hidden font-sans">

      {/* ── Chat column ─────────────────────────────────────────────── */}
      <div className="chat-column w-full flex flex-col flex-1 min-h-0 mobile-chat">
        <header className="app-header header-compact px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between z-10 shrink-0 sticky top-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <ColletMark size={22} className="text-red-600 shrink-0" />
            <span className="hainbuch-brand text-lg sm:text-xl font-black tracking-tight text-red-600">HAINBUCH</span>
            <span className="h-5 w-px bg-neutral-200 shrink-0" />
            <span className="subtitle text-sm text-neutral-500 truncate">{t.subtitle}</span>
          </div>
          <div className="flex items-center gap-2 sm:gap-4 shrink-0">
            <StatusDot onlineLabel={t.online} limitedLabel={t.limited} />
            {!isEmpty && (
              <button
                onClick={resetChat}
                disabled={isLoading}
                title={t.newChat}
                aria-label={t.newChat}
                className="flex items-center gap-1.5 text-xs text-neutral-500 hover:text-red-600 disabled:opacity-30 transition-colors rounded-md px-2 py-1 hover:bg-neutral-100"
              >
                <PenLine size={14} />
                <span className="hidden sm:inline">{t.newChat}</span>
              </button>
            )}
          </div>
        </header>

        {isLoading && pipeline && (
          <div className="relative z-20">
            <button
              onClick={() => setShowProgress(s => !s)}
              className="w-full text-left bg-white border-b border-neutral-200 hover:bg-neutral-50 transition-colors"
            >
              <div className="h-0.5 bg-neutral-100 overflow-hidden">
                <div
                  className="h-full bg-red-600 transition-all duration-700 relative overflow-hidden progress-sheen"
                  style={{ width: `${{ intent: 5, drawing: 12, chat: 55, 'retrieval-material': 22, material: 40, 'retrieval-catalog': 58, plan: 78, calc: 93 }[pipeline.stage] ?? 10}%` }}
                />
              </div>
              <div className="flex items-center justify-between px-4 py-1">
                <span className="text-[10px] text-neutral-400 truncate">
                  {pipeline.label || t.analyzing}
                </span>
                <ChevronDown size={11} className={`text-neutral-300 transition-transform shrink-0 ${showProgress ? 'rotate-180' : ''}`} />
              </div>
            </button>
            {showProgress && (
              <div className="absolute top-full left-0 right-0 bg-white border-b border-neutral-200 shadow-lg p-4 flex justify-center">
                <WaitingPanel status={pipeline} lang={uiLang} />
              </div>
            )}
          </div>
        )}
        <div ref={scrollRef} className="scroll-thin flex-1 overflow-y-auto px-3 sm:px-6 py-4 sm:py-6 bg-neutral-50" style={{minHeight:0}}>
          <div className="measure space-y-5">
          {messages.map((msg, index) => (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              key={index}
              className={`msg-group flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
            >
              <div className={`hidden sm:flex w-8 h-8 rounded-full items-center justify-center shrink-0 ${
                msg.role === 'user' ? 'bg-neutral-200 text-neutral-600' : 'bg-red-600 text-white'
              }`}>
                {msg.role === 'user' ? <User size={15} /> : <ColletMark size={17} />}
              </div>
              <div className={`message-bubble ${msg.role === 'user' ? 'user' : 'model'} ${msg.analysis ? 'max-w-full sm:max-w-[85%] flex-1' : 'max-w-[88%] sm:max-w-[75%]'} rounded-xl px-3.5 sm:px-4 py-3`}>
                {msg.parts.map((part, pIdx) => (
                  <div key={pIdx}>
                    {(index === 0 && msg.role === 'model' ? true : !!part.text) && (
                      <MessageText text={index === 0 && msg.role === 'model' ? t.welcome : (part.text || '')} />
                    )}
                    {part.inlineData && (
                      <div className="mt-2 p-2 bg-neutral-50 rounded flex items-center gap-2 border border-neutral-200 text-xs text-neutral-500">
                        {part.inlineData.mimeType === 'application/pdf' ? <FileText size={14} /> : <ImageIcon size={14} />}
                        {part.inlineData.mimeType === 'application/pdf' ? t.pdfAttached : t.drawingAttached}
                      </div>
                    )}
                  </div>
                ))}
                {msg.analysis && <AnalysisBlock analysis={msg.analysis} t={t} lang={uiLang} />}
                {msg.role === 'model' && index > 0 && (
                  <div className="msg-actions no-print mt-2 flex justify-end items-center gap-3">
                    <FeedbackButtons getText={() => messageToText(msg, t)} />
                    {msg.analysis && <PdfButton msg={msg} t={t} />}
                    <CopyButton getText={() => messageToText(msg, t)} labels={{ copy: t.copy, copied: t.copied }} />
                  </div>
                )}
              </div>
            </motion.div>
          ))}
          {isEmpty && !isLoading && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className="pl-0 sm:pl-11 pr-0 sm:pr-2"
            >
              <p className="text-[11px] font-semibold uppercase tracking-widest text-neutral-400 mb-2">
                {t.examplesLabel}
              </p>
              <div className="grid gap-2 sm:grid-cols-2 max-w-3xl">
                {t.examples.map((ex, i) => (
                  <button
                    key={i}
                    onClick={() => submitText(ex)}
                    className="chip group px-3 py-2.5 text-[12px] text-neutral-600 leading-relaxed flex items-start gap-2"
                  >
                    <ChevronRight size={13} className="mt-0.5 shrink-0 text-neutral-300 group-hover:text-red-600 transition-colors" />
                    <span>{ex}</span>
                  </button>
                ))}
              </div>
            </motion.div>
          )}
          {isLoading && pipeline && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-3">
              <div className="hidden sm:flex w-8 h-8 rounded-full bg-red-600 items-center justify-center shrink-0 text-white">
                <ColletMark size={17} />
              </div>
              <div className="pt-2 flex-1 min-w-0 max-w-md space-y-3">
                <ThinkingIndicator pipeline={pipeline} fallback={t.waitTitle} />
                <FactCarousel lang={uiLang} />
              </div>
            </motion.div>
          )}
          <div ref={messagesEndRef} />
          </div>
        </div>

        <div className="composer-wrap relative px-3 sm:px-6 pt-3 sm:pt-4 bg-white border-t border-neutral-200 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-4">
          <AnimatePresence>
            {!atBottom && (
              <motion.button
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                onClick={() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })}
                className="no-print absolute -top-11 left-1/2 -translate-x-1/2 w-9 h-9 rounded-full bg-white border border-neutral-200 shadow-md flex items-center justify-center text-neutral-500 hover:text-red-600 hover:border-red-300 transition-colors"
                aria-label="↓"
              >
                <ArrowDown size={16} />
              </motion.button>
            )}
          </AnimatePresence>
          {attachedFile && (
            <div className="measure mb-2 flex"><div className="flex items-center gap-2 px-3 py-1.5 bg-neutral-50 border border-neutral-200 rounded-lg text-xs text-neutral-600 w-fit max-w-full">
              {/\.pdf$/i.test(attachedFile.name)
                ? <FileText size={13} className="text-red-600 shrink-0" />
                : <ImageIcon size={13} className="text-red-600 shrink-0" />}
              <span className="truncate">{attachedFile.name}</span>
              <button
                type="button"
                onClick={() => setAttachedFile(null)}
                className="text-neutral-400 hover:text-red-600 transition-colors shrink-0"
                title={t.remove}
              >
                <X size={13} />
              </button>
            </div></div>
          )}
          <form
            onSubmit={handleSubmit}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              acceptDrop(e.dataTransfer.files?.[0]);
            }}
            className={`composer measure no-print relative flex items-end gap-1 px-2 py-1.5 ${dragging ? 'dragging' : ''}`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.dxf,.pdf"
              className="hidden"
              onChange={(e) => {
                setAttachedFile(e.target.files?.[0] ?? null);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
              title={t.drawingAttached}
              className={`flex items-center justify-center w-9 h-9 rounded-full transition-colors shrink-0 disabled:opacity-30 mb-0.5 ${
                attachedFile ? 'text-red-600 bg-red-50' : 'text-neutral-400 hover:text-red-600 hover:bg-neutral-100'
              }`}
            >
              <Paperclip size={16} />
            </button>
            <textarea
              ref={inputRef}
              rows={1}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void submitText(inputValue);
                }
              }}
              placeholder={dragging ? t.dropHint : t.inputPlaceholder}
              className="composer-input flex-1 bg-transparent text-sm placeholder:text-neutral-400 focus:outline-none px-2 py-2 mobile-input overflow-y-auto scroll-thin"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={isLoading || (!inputValue.trim() && !attachedFile)}
              aria-label="Senden"
              className="send-btn flex items-center justify-center w-9 h-9 rounded-full bg-red-600 text-white hover:bg-red-700 disabled:opacity-30 transition-colors shrink-0 mb-0.5"
            >
              {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} className="ml-0.5" />}
            </button>
          </form>
        </div>
      </div>

    </div>
  );
}
