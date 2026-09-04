import React, { useState, useRef, useEffect, useId, Suspense } from 'react';
import {
  Send, User, ChevronRight, ChevronDown, Loader2, FileText,
  Image as ImageIcon, Paperclip, X, Clock, TrendingDown, Copy, Check,
  ThumbsUp, ThumbsDown, FileDown, ArrowDown, PenLine, Square, ListPlus, Sparkles,
  AlertTriangle, RotateCcw, Upload, ShieldCheck, ArrowRight, Layers, Ruler, Cog,
  History, Globe, LogIn, LogOut, BookOpen, Zap
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { ChatMessage, PipelineStatus } from './types';
import WaitingPanel, { FactCarousel } from './components/WaitingPanel';
import { T, type UiLang } from './i18n';
import { API_BASE, apiHeaders } from './config';
import { num, eur } from './format';
import OperationsChart from './components/OperationsChart';
import FitDiagram from './components/FitDiagram';
import type { SetupSheetData } from './components/SetupSheetModal';
import MachineSelector, { MachineProfile, PRESET_MACHINES } from './components/MachineSelector';
// Below-the-fold modals: split into own chunks, fetched on first open.
// (MachineSelector stays in the main chunk — its button is always visible.)
const SetupSheetModal = React.lazy(() => import('./components/SetupSheetModal'));
const RoiTimeCalculatorModal = React.lazy(() => import('./components/RoiTimeCalculatorModal'));
const AuthModal = React.lazy(() => import('./components/AuthModal'));
const CountryLangPicker = React.lazy(() => import('./components/CountryLangPicker'));
const HistorySidebar = React.lazy(() => import('./components/HistorySidebar'));
import { resolveImgUrl, parseSetupSheetFromMarkdown } from './utils';
import { detectMachine } from './lib/detectMachine';
import { loadProfile, saveProfile, clearProfile, suggestedLangFor, type Profile } from './lib/profile';
import { listHist, getHist, renameHist, deleteHist, type HistoryItem } from './lib/historyApi';

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
  const renderInline = (s: string): React.ReactNode[] => {
    const imgParts = s.split(/(!\[[^\]]*\]\([^)]+\))/g);
    const out: React.ReactNode[] = [];
    imgParts.forEach((chunk, ci) => {
      const img = chunk.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
      if (img) {
        const rawSrc = img[2].trim();
        const imgSafe = /^(https?:\/\/|\/|data:image\/)/i.test(rawSrc);
        if (imgSafe) {
          const src = resolveImgUrl(rawSrc, img[1]);
          out.push(
            <img
              key={`i${ci}`}
              src={src}
              alt={img[1]}
              loading="lazy"
              className="block max-h-56 w-auto rounded-lg border border-neutral-200 bg-white my-1.5 shadow-sm"
            />
          );
        } else {
          out.push(<span key={`i${ci}`}>{img[1]}</span>);
        }
        return;
      }
      chunk.split(/(\[[^\]]+\]\([^)]+\))/g).forEach((part, i) => {
        const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (link) {
          const href = link[2].trim();
          const safe = /^(https?:\/\/|\/|#)/i.test(href);
          out.push(
            safe ? (
              <a key={`a${ci}-${i}`} href={href} target="_blank" rel="noopener noreferrer"
                 className="text-red-600 underline underline-offset-2 hover:text-red-700">
                {link[1]}
              </a>
            ) : (
              <span key={`a${ci}-${i}`}>{link[1]}</span>
            )
          );
        } else {
          part.split(/(\*\*[^*]+\*\*)/g).forEach((b, bi) =>
            out.push(
              b.startsWith('**') && b.endsWith('**') ? (
                <strong key={`b${ci}-${i}-${bi}`} className="font-semibold text-neutral-900">{b.slice(2, -2)}</strong>
              ) : (
                b
              )
            )
          );
        }
      });
    });
    return out;
  };

  const lines = text.split('\n');
  const blocks: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (!t) { blocks.push(<div key={`s${i}`} className="h-1" />); i++; continue; }
    
    // Fenced Code Blocks (e.g. ```gcode or ```text)
    if (t.startsWith('```')) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length && lines[i].trim().startsWith('```')) {
        i++; // skip closing fence
      }
      blocks.push(
        <div key={`c${i}`} className="my-2.5 overflow-x-auto rounded-xl bg-neutral-900 text-neutral-100 p-3 font-mono text-xs border border-neutral-800 shadow-sm leading-relaxed -mx-1 sm:mx-0">
          <pre className="whitespace-pre">{codeLines.join('\n')}</pre>
        </div>
      );
      continue;
    }

    // Markdown Tables with mobile-optimized horizontal scrolling
    if (t.startsWith('|') && i + 1 < lines.length && /^\|[\s:|-]+\|?$/.test(lines[i + 1].trim())) {
      const rows: string[][] = [];
      const head = t.split('|').slice(1, -1).map(c => c.trim());
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(lines[i].trim().split('|').slice(1, -1).map(c => c.trim()));
        i++;
      }
      blocks.push(
        <div key={`t${i}`} className="overflow-x-auto my-3 -mx-1 sm:mx-0 rounded-xl border border-neutral-200/90 shadow-sm bg-white scroll-thin">
          <table className="text-xs border-collapse w-full min-w-[480px]">
            <thead>
              <tr className="border-b border-neutral-200 bg-neutral-100/80">
                {head.map((c, ci) => (
                  <th key={ci} className="px-3 py-2 text-left font-bold text-neutral-800 tracking-tight">
                    {renderInline(c)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200/70">
              {rows.map((r, ri) => (
                <tr key={ri} className={ri % 2 === 1 ? 'bg-neutral-50/60 hover:bg-red-50/30 transition-colors' : 'hover:bg-red-50/30 transition-colors'}>
                  {r.map((c, ci) => (
                    <td key={ci} className="px-3 py-2 align-top text-neutral-700">
                      {renderInline(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }
    if (t.startsWith('###') || t.startsWith('##')) {
      blocks.push(
        <p key={`h${i}`} className="font-bold text-neutral-950 mt-3 text-sm tracking-tight">
          {t.replace(/^#+\s*/, '')}
        </p>
      );
      i++;
      continue;
    }
    if (/^[-•]\s/.test(t)) {
      blocks.push(
        <p key={`l${i}`} className="pl-4 relative text-neutral-800">
          <span className="absolute left-1 text-red-600 font-bold">•</span>
          {renderInline(t.replace(/^[-•]\s/, ''))}
        </p>
      );
      i++;
      continue;
    }
    blocks.push(<p key={`p${i}`} className="text-neutral-800">{renderInline(line0(lines[i]))}</p>);
    i++;
  }

  return <div className="text-sm leading-relaxed space-y-1.5">{blocks}</div>;
}

function line0(l: string): string {
  return l;
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

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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

function FeedbackButtons({ getText, conversationId }: { getText: () => string; conversationId?: string | null }) {
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

/** Live countdown from Retry-After seconds ("in 42 Min" / "in 3 Std 12 Min"). */
function RetryCountdown({ sec, t }: { sec: number; t: (typeof T)[keyof typeof T] }) {
  const [left, setLeft] = useState(sec);
  useEffect(() => {
    setLeft(sec);
    if (sec <= 0) return;
    const id = setInterval(() => setLeft(s => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(id);
  }, [sec]);
  if (left <= 0) return null;
  const h = Math.floor(left / 3600);
  const m = Math.ceil((left % 3600) / 60);
  const label = h > 0 ? `${h} ${t.hrsShort} ${m} ${t.minShort}` : `${m} ${t.minShort}`;
  return <span className="font-mono font-semibold">{t.retryIn} {label}</span>;
}

/** Failed turn: red-tinted bubble with reason, live retry countdown, retry button. */
function ErrorBubble({ kind, retryAfterSec, onRetry, t }: {
  kind: 'rate' | 'offline' | 'server';
  retryAfterSec?: number;
  onRetry: () => void;
  t: (typeof T)[keyof typeof T];
}) {
  const msg = kind === 'rate' ? t.errorRate : kind === 'offline' ? t.errorOffline : `${t.errorMsg}.`;
  return (
    <div className="text-sm leading-relaxed">
      <div className="flex items-start gap-2">
        <AlertTriangle size={16} className="text-red-600 shrink-0 mt-0.5" />
        <p className="text-neutral-800 font-medium">{msg}</p>
      </div>
      {kind === 'rate' && retryAfterSec !== undefined && retryAfterSec > 0 && (
        <p className="text-xs text-neutral-500 mt-1.5 ml-6">
          <RetryCountdown sec={retryAfterSec} t={t} />
        </p>
      )}
      <button
        onClick={onRetry}
        className="tap mt-2.5 ml-6 inline-flex items-center gap-1.5 px-3.5 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-xl transition-colors shadow-sm"
      >
        <RotateCcw size={13} />
        {t.retry}
      </button>
    </div>
  );
}

/** Collapsible answer section with anchor id (long Auslegungen stay navigable). */
function Section({ id, title, accent, defaultOpen, children }: {
  id?: string; title: React.ReactNode; accent?: boolean; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div id={id} className="border border-neutral-200 rounded-lg bg-white overflow-hidden scroll-mt-28">
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 px-3 sm:px-4 py-2.5 sm:py-3 text-left hover:bg-neutral-50/60 transition-colors"
      >
        <h4 className={`text-[11px] font-semibold uppercase tracking-wider ${accent ? 'text-red-600' : 'text-neutral-400'}`}>{title}</h4>
        <ChevronDown size={14} className={`text-neutral-400 transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="px-3 sm:px-4 pb-3 sm:pb-4">{children}</div>}
    </div>
  );
}

/** Structured pipeline result (fits, plan, cutting data, products) shown under the message. */
function AnalysisBlock({ analysis, t, lang }: { analysis: NonNullable<ChatMessage['analysis']>; t: (typeof T)[keyof typeof T]; lang: UiLang }) {
  const ma = analysis.manufacturingAnalysis;
  const recs = analysis.recommendations;
  const fits = analysis.fitSolutions;
  const uid = useId().replace(/:/g, '');
  // Desktop: everything open. Mobile: only material + plan open, rest collapsed.
  const wide = typeof window !== 'undefined' && window.innerWidth >= 640;
  const nav: { id: string; label: string }[] = [];
  if (ma?.material) nav.push({ id: `${uid}-mat`, label: t.material });
  if (ma && Array.isArray(ma.operations) && ma.operations.length > 0) nav.push({ id: `${uid}-plan`, label: t.plan });
  if (analysis.clampingCheck) nav.push({ id: `${uid}-clamp`, label: t.clampCheck });
  if (analysis.costComparison) nav.push({ id: `${uid}-cost`, label: t.costCompare });
  if (recs && recs.length > 0) nav.push({ id: `${uid}-rec0`, label: `${t.recommendation} 1${recs.length > 1 ? `–${recs.length}` : ''}` });
  return (
    <div className="mt-3 space-y-3">
      {nav.length >= 3 && (
        <nav className="no-print flex flex-wrap gap-1.5" aria-label={t.plan}>
          {nav.map(n => (
            <a key={n.id} href={`#${n.id}`}
               className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 hover:text-red-600 bg-white border border-neutral-200 hover:border-red-300 rounded-full px-2.5 py-1 transition-colors">
              {n.label}
            </a>
          ))}
        </nav>
      )}
      {fits && fits.length > 0 && fits.map((fit, i) => <FitDiagram key={i} fit={fit} />)}

      {ma && (
        <>
          {ma.material && (
            <Section id={`${uid}-mat`} title={t.material} accent defaultOpen>
              <p className="text-sm text-neutral-900 font-semibold">{ma.material.name}</p>
              <p className="text-xs text-neutral-500 mt-1 leading-relaxed">{ma.material.reasoning}</p>
              {ma.rawMaterialRecommendation && (
                <p className="text-xs text-neutral-600 mt-2">
                  <span className="font-medium">{t.rawMaterial}:</span> {ma.rawMaterialRecommendation}
                </p>
              )}
            </Section>
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
          <Section id={`${uid}-plan`} title={t.plan} defaultOpen>
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
          </Section>
          )}
        </>
      )}

      {analysis.clampingCheck && (
        <Section
          id={`${uid}-clamp`}
          title={<>{t.clampCheck} · erforderlich ≈ {num(analysis.clampingCheck.requiredClampForceKn, lang, 1)} kN</>}
          accent
          defaultOpen={wide}
        >
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
        </Section>
      )}

      {analysis.costComparison && (
        <Section
          id={`${uid}-cost`}
          title={<>{t.costCompare} · {num(analysis.costComparison.batchSize, lang, 0)} Stk · {num(analysis.costComparison.hourlyRateEur, lang, 0)} €/h</>}
          accent
          defaultOpen={wide}
        >
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
        </Section>
      )}

      {recs && recs.length > 0 && recs.map((rec, recIdx) => (
        <Section
          key={recIdx}
          id={`${uid}-rec${recIdx}`}
          title={<>{t.recommendation} {recIdx + 1} · {rec.product}</>}
          accent={recIdx === 0}
          defaultOpen={wide || recIdx === 0}
        >
          {rec.imageUrl && (
            <img
              src={resolveImgUrl(rec.imageUrl, rec.product)}
              alt={rec.product}
              loading="lazy"
              className="w-full h-40 sm:h-56 object-contain bg-white border border-neutral-100 rounded-lg mb-3"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          )}
          <div>
            <div className="text-[10px] font-semibold text-red-600 uppercase tracking-wider mb-1">
              {t.recommendation} {recIdx + 1}
            </div>
            <h2 className="text-base font-semibold text-neutral-900 mb-1.5">{rec.product}</h2>
            <p className="text-[13px] text-neutral-600 leading-relaxed">{rec.description}</p>
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
            <div className="no-print mt-3 flex flex-wrap gap-2">
              <a
                href="https://shop.hainbuch.com"
                target="_blank" rel="noopener noreferrer"
                className="tap inline-flex items-center gap-1.5 px-3.5 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-semibold rounded-xl transition-colors shadow-sm"
              >
                {t.shopCta}
                <ArrowRight size={12} />
              </a>
              <a
                href="tel:+4971449070"
                className="tap inline-flex items-center gap-1.5 px-3.5 py-2 bg-white hover:bg-neutral-50 text-neutral-800 text-xs font-semibold rounded-xl transition-colors border border-neutral-300 hover:border-red-400 shadow-sm"
              >
                {t.adviceCta}
              </a>
            </div>
          </div>
        </Section>
      ))}

      {analysis.ecosystem && analysis.ecosystem.length > 0 && (
        <Section id={`${uid}-eco`} title="Das passende Komplettpaket" accent defaultOpen={wide}>
          <div className="space-y-2">
            {analysis.ecosystem.map((e, i) => (
              <div key={i} className="text-[12px]">
                <span className="font-semibold text-neutral-800">{e.category}: </span>
                <span className="text-neutral-700">{e.suggestion}</span>
                <p className="text-[11px] text-neutral-400 leading-relaxed">{e.reason}</p>
                {e.products && e.products.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {e.products.map((p, j) => (
                      <li key={j} className="text-[11px] text-neutral-600 flex flex-wrap gap-x-2">
                        <span>{p.name}</span>
                        <span className="font-mono text-neutral-400">Mat.-Nr. {p.materialNo}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
          {analysis.salesNudge && (
            <p className="text-[11px] text-neutral-600 mt-3 pt-2 border-t border-neutral-100 leading-relaxed">
              💡 {analysis.salesNudge}
            </p>
          )}
        </Section>
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
        .then(s => setOnline(!!s.llmOnline))
        .catch(() => setOnline(false));
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);
  if (online === null) return null;
  return (
    <span className="flex items-center gap-1.5 text-xs text-neutral-500" title={online ? onlineLabel : limitedLabel}>
      <span className={`w-2 h-2 rounded-full ${online ? 'bg-green-500' : 'bg-neutral-300'}`} />
      <span className="hidden sm:inline">{online ? onlineLabel : limitedLabel}</span>
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
  // Language: stored choice wins (country picker / profile). Geo suggestion
  // applies only when the user never chose (no profile, no ui-lang key).
  const [profile, setProfile] = useState<Profile>(() => loadProfile());
  const [uiLang, setUiLang] = useState<UiLang>(() => profile.uiLangOverride || 'de');
  const [geoCountry, setGeoCountry] = useState('');
  const t = T[uiLang];

  // IP drives the language: every load asks /api/status for the Cloudflare
  // country and follows it — UNLESS the user picked a language manually
  // (stored override always wins, on every device state).
  useEffect(() => {
    fetch(`${API_BASE}/api/status`)
      .then(r => r.json())
      .then(s => {
        const cc = typeof s.country === 'string' ? s.country : '';
        if (cc) setGeoCountry(cc);
        // A manual pick in the country picker pins the language (stored
        // override). Everything else follows the IP country on every load.
        let override = '';
        try {
          override = loadProfile().uiLangOverride || '';
        } catch { /* ignore */ }
        if (override || !cc) return;
        if (COUNTRY_LANG[cc]) setUiLang(COUNTRY_LANG[cc]);
        else setUiLang('en');
      })
      .catch(() => { /* stay with stored/default */ });
  }, []);
  // Keep the current language visible to apiHeaders (x-ui-lang) on every change.
  useEffect(() => {
    try {
      localStorage.setItem('ui-lang', uiLang);
    } catch { /* ignore */ }
  }, [uiLang]);
  // History + auth UI state
  const [showAuth, setShowAuth] = useState(false);
  // Account menu (avatar button never logs out directly).
  const [showAccount, setShowAccount] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showAccount) return;
    const onDown = (e: MouseEvent) => {
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) {
        setShowAccount(false);
        setConfirmLogout(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setShowAccount(false); setConfirmLogout(false); }
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [showAccount]);
  const [showCountry, setShowCountry] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [histItems, setHistItems] = useState<HistoryItem[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [selectedMachine, setSelectedMachine] = useState<MachineProfile>(PRESET_MACHINES[0]);
  // Antwort-Modus: Katalog (RAG + Fotos + QA) oder Direkt (nur Modell, ein Call).
  const [catalogMode, setCatalogMode] = useState<boolean>(() => {
    try { return localStorage.getItem('hb-catalog-mode') !== '0'; } catch { return true; }
  });
  const toggleCatalogMode = () => {
    setCatalogMode((v) => {
      try { localStorage.setItem('hb-catalog-mode', v ? '0' : '1'); } catch {}
      return !v;
    });
  };
  // Machine auto-detect: suggestion chip (+ undo when auto-applied).
  const [machineHint, setMachineHint] = useState<{ preset: MachineProfile; auto: boolean } | null>(null);
  const dismissedMachines = useRef<Set<string>>(new Set());
  const prevMachineRef = useRef<MachineProfile | null>(null);

  const [activeSetupSheet, setActiveSetupSheet] = useState<SetupSheetData | null>(null);
  const [showRoiModal, setShowRoiModal] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([{
    role: "model",
    parts: [{ text: "" }]  // index 0 is always rendered from t.welcome
  }]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [pipeline, setPipeline] = useState<PipelineStatus | null>(null);
  const [showProgress, setShowProgress] = useState(false);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [queuedMessages, setQueuedMessages] = useState<{ text: string; file: File | null }[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  // Mirror of messages for use inside async submit (avoids side-effects
  // inside setMessages updaters, which StrictMode double-invokes).
  const messagesRef = useRef(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  // Last outbound request (for the error-bubble retry button).
  const lastRequestRef = useRef<ChatMessage[] | null>(null);

  const stopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsLoading(false);
    setPipeline(null);
    setShowProgress(false);
  };

  // Stop generation or cancel attachment when Escape is pressed
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isLoading) {
          e.preventDefault();
          stopGeneration();
        } else if (attachedFile) {
          setAttachedFile(null);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isLoading, attachedFile]);

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

  // Tab title reflects how many analyses exist in this chat.
  const answerCount = messages.filter(m => m.role === 'model' && (m.analysis || m.error)).length;
  useEffect(() => {
    document.title = answerCount > 0
      ? `(${answerCount}) HAINBUCH Technical Advisor`
      : 'HAINBUCH Technical Advisor';
  }, [answerCount]);

  // Auto-grow the composer up to the CSS max-height.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [inputValue]);

  // Consume the NDJSON pipeline stream: status events update the waiting
  // panel; the final "result" line carries the full analysis.
  const sendChat = async (newMessages: ChatMessage[], machineOverride?: MachineProfile) => {
    setIsLoading(true);
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setPipeline({ stage: 'intent', label: '', infos: [], log: [], startedAt: Date.now() });
    try {
      const apiMessages = newMessages
        .filter((msg, idx) => !(idx === 0 && msg.role === 'model'))
        .map(({ role, parts }) => ({ role, parts }));
      const response = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({
          messages: apiMessages,
          machine: machineOverride || selectedMachine,
          ...(catalogMode ? {} : { mode: "raw" }),
          conversationId: conversationId || undefined,
          email: profile.email || undefined,
          country: profile.country || undefined,
          uiLang,
        }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const retryAfter = Number(response.headers.get('Retry-After') || 0);
        const err: any = new Error(`HTTP ${response.status}`);
        err.status = response.status;
        err.retryAfterSec = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined;
        throw err;
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
      if (result.conversationId) setConversationId(result.conversationId);

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
      if (error?.name === 'AbortError' || controller.signal.aborted) {
        console.log('Chat generation cancelled by user.');
        return;
      }
      console.error('Chat API Error:', error);
      const kind = error?.status === 429 ? 'rate'
        : (error instanceof TypeError || error?.message === 'Failed to fetch') ? 'offline'
        : 'server';
      setMessages(prev => [...prev, {
        role: 'model',
        parts: [{ text: '' }],
        error: { kind, retryAfterSec: error?.retryAfterSec },
      }]);
    } finally {
      setIsLoading(false);
      setPipeline(null);
      setShowProgress(false);
      abortControllerRef.current = null;
    }
  };

  const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
  const convertFileToBase64 = (file: File): Promise<{base64: string, mimeType: string}> => {
    return new Promise((resolve, reject) => {
      if (file.size > MAX_UPLOAD_BYTES) {
        reject(new Error('file too large (max 15 MB)'));
        return;
      }
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
        img.onerror = () => {
          // Browser kann das Format nicht dekodieren (HEIC/AVIF …) → Rohdaten senden
          resolve({ base64: (reader.result as string).split(',')[1], mimeType: file.type || 'image/png' });
        };
        img.src = reader.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const executeSubmit = async (text: string, file: File | null) => {
    if (!text.trim() && !file) return;
    const parts: ChatMessage['parts'] = [];
    if (file) {
      try {
        const { base64, mimeType } = await convertFileToBase64(file);
        parts.push({ inlineData: { data: base64, mimeType } });
        const defaultPrompt = uiLang === 'de'
          ? 'Bitte analysiere diese technische Zeichnung vollständig: Geometrie, Maße, Toleranzen, Passungen nach ISO 286, Werkstoffempfehlung und passende HAINBUCH-Spannmittel.'
          : 'Please analyze this technical drawing completely: geometry, dimensions, tolerances, ISO 286 fits, material recommendation, and suitable HAINBUCH workholding solutions.';
        parts.push({ text: text.trim() || defaultPrompt });
      } catch (err) {
        console.error('File attach failed:', err);
      }
    } else if (text.trim()) {
      parts.push({ text: text.trim() });
    }
    if (parts.length === 0) return;
    // Machine auto-detect: a stated machine powers this very request when the
    // selector is still on default; otherwise it becomes a suggestion chip.
    let machineForRequest: MachineProfile | undefined;
    const det = detectMachine(text);
    if (det && det.presetId !== selectedMachine.id && !dismissedMachines.current.has(det.presetId)) {
      const preset = PRESET_MACHINES.find((p) => p.id === det.presetId);
      if (preset) {
        if (selectedMachine.id === 'univ-all' && det.specific) {
          prevMachineRef.current = selectedMachine;
          setSelectedMachine(preset);
          machineForRequest = preset;
          setMachineHint({ preset, auto: true });
        } else {
          setMachineHint({ preset, auto: false });
        }
      }
    }
    const nextMsgs = [...messagesRef.current, { role: 'user' as const, parts }];
    messagesRef.current = nextMsgs;
    setMessages(nextMsgs);
    lastRequestRef.current = nextMsgs;
    void sendChat(nextMsgs, machineForRequest);
  };

  const retryLast = () => {
    if (isLoading || !lastRequestRef.current) return;
    // Drop the error bubble, resend the last user request as-is.
    setMessages(prev => {
      const last = prev[prev.length - 1];
      const next = last?.error ? prev.slice(0, -1) : prev;
      messagesRef.current = next;
      return next;
    });
    void sendChat(lastRequestRef.current);
  };

  // Machine-hint chip actions.
  const applyMachineHint = () => {
    if (!machineHint) return;
    prevMachineRef.current = selectedMachine;
    setSelectedMachine(machineHint.preset);
    dismissedMachines.current.delete(machineHint.preset.id);
    setMachineHint(null);
  };
  const undoMachineHint = () => {
    if (machineHint?.auto && prevMachineRef.current) setSelectedMachine(prevMachineRef.current);
    if (machineHint) dismissedMachines.current.add(machineHint.preset.id);
    setMachineHint(null);
  };
  const dismissMachineHint = () => {
    if (machineHint) dismissedMachines.current.add(machineHint.preset.id);
    setMachineHint(null);
  };

  // Automatically process queued messages when loading finishes
  useEffect(() => {
    if (!isLoading && queuedMessages.length > 0) {
      const nextItem = queuedMessages[0];
      setQueuedMessages(prev => prev.slice(1));
      void executeSubmit(nextItem.text, nextItem.file);
    }
  }, [isLoading, queuedMessages]);

  const submitText = async (text: string) => {
    if (isLoading) {
      setQueuedMessages(prev => [...prev, { text, file: null }]);
      return;
    }
    await executeSubmit(text, null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() && !attachedFile) return;
    if (isLoading) {
      setQueuedMessages(prev => [...prev, { text: inputValue, file: attachedFile }]);
      setInputValue('');
      setAttachedFile(null);
      return;
    }
    const text = inputValue;
    const file = attachedFile;
    setInputValue('');
    setAttachedFile(null);
    await executeSubmit(text, file);
  };

  const resetChat = () => {
    if (isLoading) stopGeneration();
    setQueuedMessages([]);
    setConversationId(null);
    setMessages([{ role: 'model', parts: [{ text: '' }] }]);
    setInputValue('');
    setAttachedFile(null);
  };

  // ── History: list / open / rename / delete (login via AuthModal) ──
  const refreshHistList = async () => {
    if (!profile.email && !profile.token) return;
    setHistLoading(true);
    try {
      setHistItems(await listHist());
    } catch { /* offline — sidebar shows empty state */ }
    finally {
      setHistLoading(false);
    }
  };
  const openHistoryPanel = () => {
    setShowHistory(true);
    void refreshHistList();
  };
  const openConversation = async (id: string) => {
    const c = await getHist(id);
    if (!c) return;
    const msgs: ChatMessage[] = [{ role: 'model', parts: [{ text: '' }] }];
    for (const m of c.messages || []) {
      if (m.role === 'user') msgs.push({ role: 'user', parts: [{ text: m.content }] });
      else msgs.push({ role: 'model', parts: [{ text: m.content }] });
    }
    if (isLoading) stopGeneration();
    setQueuedMessages([]);
    setConversationId(id);
    setMessages(msgs.length > 1 ? msgs : [{ role: 'model', parts: [{ text: '' }] }]);
    setShowHistory(false);
  };
  const handleAuthSaved = (r: { email: string; displayName: string; country: string; token: string }) => {
    const next: Profile = {
      ...profile,
      email: r.email,
      displayName: r.displayName,
      country: r.country || profile.country || geoCountry,
      token: r.token,
    };
    // Fresh login without a manual language choice follows the IP country.
    if (!next.uiLangOverride) {
      const s = (next.country && suggestedLangFor(next.country))
        || (geoCountry && COUNTRY_LANG[geoCountry]) || null;
      if (s) setUiLang(s);
    }
    setProfile(next);
    saveProfile(next);
    setShowAuth(false);
    void refreshHistList();
  };
  const handleLogout = () => {
    clearProfile();
    setProfile(loadProfile());
    setHistItems([]);
    setShowAccount(false);
    setConfirmLogout(false);
    resetChat();
  };
  const handleCountryPick = (country: string, lang: UiLang) => {
    setUiLang(lang);
    const next: Profile = { ...profile, country, uiLangOverride: lang };
    setProfile(next);
    saveProfile(next);
  };

  const acceptDrop = (f: File | undefined) => {
    if (!f) return;
    const ext = '.' + (f.name.split('.').pop() || '').toLowerCase();
    if (f.type.startsWith('image/') || ['image/*'].includes(f.type) ||
        ['.png','.jpg','.jpeg','.webp','.gif','.bmp','.avif','.heic','.heif','.jfif','.svg','.dxf','.pdf'].includes(ext)) {
      if (isEmpty && !isLoading) {
        void executeSubmit('', f);
      } else {
        setAttachedFile(f);
      }
    }
  };

  // Empty state = only the synthetic welcome message is present.
  const isEmpty = messages.length === 1;

  return (
    <div className="app-root h-[100dvh] bg-white text-neutral-800 flex flex-col overflow-hidden font-sans">

      {/* ── Chat column ─────────────────────────────────────────────── */}
      <div
        className="chat-column w-full flex flex-col flex-1 min-h-0 mobile-chat relative"
        onDragOver={(e) => { e.preventDefault(); if (!dragging) setDragging(true); }}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          acceptDrop(e.dataTransfer.files?.[0]);
        }}
      >
        {dragging && (
          <div className="absolute inset-0 z-50 no-print flex items-center justify-center bg-red-600/10 backdrop-blur-[2px] border-4 border-dashed border-red-600 rounded-lg m-2 pointer-events-none">
            <div className="bg-white rounded-xl px-5 py-3 shadow-lg font-semibold text-red-600 text-sm">
              Bild / Zeichnung hier ablegen
            </div>
          </div>
        )}
        <header className="app-header header-compact px-3 sm:px-6 py-2.5 sm:py-3 flex items-center justify-between z-10 shrink-0 sticky top-0">
          <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
            <ColletMark size={22} className="text-red-600 shrink-0" />
            <span className="hainbuch-brand text-lg sm:text-xl font-black tracking-tight text-red-600">HAINBUCH</span>
            <span className="h-4 sm:h-5 w-px bg-neutral-200 shrink-0 hidden xs:inline" />
            <span className="subtitle text-xs sm:text-sm text-neutral-500 truncate hidden sm:inline">{t.subtitle}</span>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
            <StatusDot onlineLabel={t.online} limitedLabel={t.limited} />
            <button
              onClick={() => (profile.email || profile.token ? openHistoryPanel() : setShowAuth(true))}
              title={t.history}
              aria-label={t.history}
              className="flex items-center gap-1 text-xs text-neutral-600 hover:text-red-600 transition-colors rounded-xl px-2.5 py-1.5 bg-white border border-neutral-200/90 hover:border-red-300 shadow-sm h-9"
            >
              <History size={14} className="shrink-0" />
            </button>
            <button
              onClick={() => setShowCountry(true)}
              title={`${t.country} / ${t.language}`}
              aria-label={`${t.country} / ${t.language}`}
              className="flex items-center gap-1 text-xs text-neutral-600 hover:text-red-600 transition-colors rounded-xl px-2.5 py-1.5 bg-white border border-neutral-200/90 hover:border-red-300 shadow-sm h-9"
            >
              <Globe size={14} className="shrink-0" />
              {profile.country && <span className="font-mono font-semibold">{profile.country}</span>}
            </button>
            {profile.email ? (
              <div ref={accountRef} className="relative">
                <button
                  onClick={() => { setShowAccount((v) => !v); setConfirmLogout(false); }}
                  title={profile.email}
                  aria-label={profile.email}
                  aria-haspopup="menu" aria-expanded={showAccount}
                  className="flex items-center gap-1 text-xs text-neutral-600 hover:text-red-600 transition-colors rounded-xl px-2.5 py-1.5 bg-white border border-neutral-200/90 hover:border-red-300 shadow-sm h-9"
                >
                  <User size={14} className="shrink-0" />
                  <span className="hidden sm:inline font-medium max-w-[120px] truncate">{profile.displayName || profile.email}</span>
                </button>
                {showAccount && (
                  <div role="menu" className="absolute right-0 top-full mt-1.5 w-60 rounded-xl bg-white border border-neutral-200 shadow-xl p-1.5 z-50">
                    <p className="px-2.5 py-2 text-xs text-neutral-500 truncate border-b border-neutral-100 mb-1">{profile.email}</p>
                    <button
                      role="menuitem"
                      onClick={() => { setShowAccount(false); setConfirmLogout(false); openHistoryPanel(); }}
                      className="w-full flex items-center gap-2 px-2.5 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-100 rounded-lg transition-colors"
                    >
                      <History size={14} className="text-neutral-400" /> {t.history}
                    </button>
                    {confirmLogout ? (
                      <div className="px-2.5 py-2">
                        <p className="text-xs font-semibold text-neutral-800 mb-2">{t.logoutSure}</p>
                        <div className="flex gap-1.5">
                          <button
                            onClick={handleLogout}
                            className="flex-1 px-2 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg transition-colors"
                          >
                            {t.logout}
                          </button>
                          <button
                            onClick={() => setConfirmLogout(false)}
                            className="flex-1 px-2 py-1.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-xs font-semibold rounded-lg transition-colors"
                          >
                            {t.cancel}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        role="menuitem"
                        onClick={() => setConfirmLogout(true)}
                        className="w-full flex items-center gap-2 px-2.5 py-2 text-xs font-semibold text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <LogOut size={14} /> {t.logout}
                      </button>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={() => setShowAuth(true)}
                title={t.login}
                aria-label={t.login}
                className="flex items-center gap-1 text-xs text-neutral-600 hover:text-red-600 transition-colors rounded-xl px-2.5 py-1.5 bg-white border border-neutral-200/90 hover:border-red-300 shadow-sm h-9"
              >
                <LogIn size={14} className="shrink-0" />
                <span className="hidden sm:inline font-medium">{t.login}</span>
              </button>
            )}
            {!isEmpty && (
              <button
                onClick={resetChat}
                disabled={isLoading}
                title={t.newChat}
                aria-label={t.newChat}
                className="flex items-center gap-1.5 text-xs text-neutral-600 hover:text-red-600 disabled:opacity-30 transition-colors rounded-xl px-2.5 py-1.5 bg-white border border-neutral-200/90 hover:border-red-300 shadow-sm h-9"
              >
                <PenLine size={14} className="shrink-0" />
                <span className="hidden sm:inline font-medium">{t.newChat}</span>
              </button>
            )}
          </div>
        </header>
        {/* Context toolbar: machine profile + ROI calculator (affects the analysis). Always visible on mobile & desktop. */}
        <div className="no-print shrink-0 border-b border-neutral-100 bg-white/95 backdrop-blur relative z-30 overflow-visible">
          <div className="measure flex items-center gap-2 px-3 sm:px-6 py-1.5 relative overflow-visible">
            <MachineSelector selected={selectedMachine} onSelect={setSelectedMachine} />
            {machineHint && (
              <div className="flex items-center gap-1.5 px-2.5 h-9 rounded-xl bg-red-50 border border-red-200 text-xs shrink-0 max-w-[70vw] sm:max-w-none">
                <Sparkles size={13} className="text-red-600 shrink-0" />
                <span className="font-semibold text-neutral-700 truncate">{t.machineDetected}: {machineHint.preset.name}</span>
                {machineHint.auto ? (
                  <button onClick={undoMachineHint} className="font-bold text-red-700 hover:text-red-900 shrink-0">{t.undoMachine}</button>
                ) : (
                  <button onClick={applyMachineHint} className="font-bold text-red-700 hover:text-red-900 shrink-0">{t.applyMachine}</button>
                )}
                <button onClick={dismissMachineHint} aria-label={t.cancel} className="text-neutral-400 hover:text-neutral-700 shrink-0">
                  <X size={13} />
                </button>
              </div>
            )}
            <button
              onClick={() => setShowRoiModal(true)}
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl bg-white hover:bg-neutral-50 border border-neutral-300/90 hover:border-red-600 shadow-sm hover:shadow text-xs font-semibold text-neutral-800 hover:text-red-700 transition-all group h-9 shrink-0 cursor-pointer"
              title="Wirtschaftlichkeits- & Zeitrechner öffnen"
            >
              <Clock size={14} className="text-red-600 group-hover:rotate-45 transition-transform shrink-0" />
              <span className="hidden xs:inline">Zeitrechner</span>
            </button>
            <button
              onClick={toggleCatalogMode}
              title={catalogMode ? t.catalogMode : t.directMode}
              className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl border shadow-sm text-xs font-semibold h-9 shrink-0 cursor-pointer transition-all ${
                catalogMode
                  ? 'bg-white hover:bg-neutral-50 border-neutral-300/90 text-neutral-800'
                  : 'bg-neutral-900 hover:bg-neutral-800 border-neutral-900 text-white'
              }`}
            >
              {catalogMode
                ? <BookOpen size={14} className="text-red-600 shrink-0" />
                : <Zap size={14} className="shrink-0" />}
              <span className="hidden xs:inline">{catalogMode ? t.catalogMode : t.directMode}</span>
            </button>
          </div>
        </div>

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
          {/* In active chat (!isEmpty), render conversation messages */}
          {!isEmpty && messages.map((msg, index) => (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              key={index}
              className={`msg-group flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
            >
              <div className={`hidden sm:flex w-8 h-8 rounded-full items-center justify-center shrink-0 ${
                msg.role === 'user' ? 'bg-neutral-100 text-neutral-700 border border-neutral-200 shadow-sm' : 'bg-red-600 text-white shadow-sm'
              }`}>
                {msg.role === 'user' ? <User size={15} /> : <ColletMark size={17} />}
              </div>
              <div className={`message-bubble ${msg.role === 'user' ? 'user' : 'model'} ${msg.analysis ? 'max-w-full sm:max-w-[85%] flex-1' : 'max-w-[88%] sm:max-w-[75%]'} rounded-2xl px-3.5 sm:px-4 py-3 ${msg.error ? '!border-red-200 !bg-red-50/60' : ''}`}>
                {msg.error ? (
                  <ErrorBubble kind={msg.error.kind} retryAfterSec={msg.error.retryAfterSec} onRetry={retryLast} t={t} />
                ) : (
                <>{msg.parts.map((part, pIdx) => (
                  <div key={pIdx}>
                    {(index === 0 && msg.role === 'model' ? true : !!part.text) && (
                      <MessageText text={index === 0 && msg.role === 'model' ? t.welcome : (part.text || '')} />
                    )}
                    {part.inlineData && (
                      part.inlineData.mimeType.startsWith('image/') ? (
                        <div className="mt-2.5 rounded-xl overflow-hidden border border-neutral-200/90 shadow-sm max-w-sm bg-white group">
                          <img
                            src={`data:${part.inlineData.mimeType};base64,${part.inlineData.data}`}
                            alt="Hochgeladene technische Zeichnung"
                            className="w-full max-h-64 object-contain bg-neutral-50/60 cursor-pointer group-hover:scale-[1.01] transition-transform duration-200"
                            onClick={() => setPreviewImage(`data:${part.inlineData!.mimeType};base64,${part.inlineData!.data}`)}
                          />
                          <div
                            className="px-3 py-1.5 bg-white border-t border-neutral-100 flex items-center justify-between text-xs text-neutral-600 cursor-pointer"
                            onClick={() => setPreviewImage(`data:${part.inlineData!.mimeType};base64,${part.inlineData!.data}`)}
                          >
                            <span className="flex items-center gap-1.5 font-medium text-neutral-700">
                              <ImageIcon size={14} className="text-red-600 shrink-0" />
                              {t.drawingAttached || 'Zeichnung'}
                            </span>
                            <span className="text-[11px] text-neutral-400 group-hover:text-red-600 transition-colors">
                              Vergrößern 🔍
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-2 p-2 bg-neutral-50 rounded flex items-center gap-2 border border-neutral-200 text-xs text-neutral-500">
                          {part.inlineData.mimeType === 'application/pdf' ? <FileText size={14} /> : <ImageIcon size={14} />}
                          {part.inlineData.mimeType === 'application/pdf' ? t.pdfAttached : t.drawingAttached}
                        </div>
                      )
                    )}
                  </div>
                ))}</>
                )}
                {msg.analysis && <AnalysisBlock analysis={msg.analysis} t={t} lang={uiLang} />}
                {msg.role === 'model' && index > 0 && !msg.error && (
                  <div className="msg-actions no-print mt-2.5 flex flex-wrap justify-end items-center gap-2">
                    <button
                      onClick={() => {
                        const text = msg.parts.map(p => p.text).join('\n');
                        const sheet = parseSetupSheetFromMarkdown(text);
                        if (sheet) setActiveSetupSheet(sheet);
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-white hover:bg-red-50 text-neutral-800 hover:text-red-700 transition-all border border-neutral-300 hover:border-red-600 shadow-sm group"
                      title="Werkstatt-Einrichteblatt öffnen & als DIN A4 PDF drucken"
                    >
                      <FileText size={14} className="text-red-600 group-hover:scale-110 transition-transform shrink-0" />
                      <span>Einrichteblatt (PDF)</span>
                    </button>
                    <FeedbackButtons getText={() => messageToText(msg, t)} conversationId={conversationId} />
                    {msg.analysis && <PdfButton msg={msg} t={t} />}
                    <CopyButton getText={() => messageToText(msg, t)} labels={{ copy: t.copy, copied: t.copied }} />
                  </div>
                )}
              </div>
            </motion.div>
          ))}

          {/* Ultra-Clean Minimalist Home/Empty State */}
          {isEmpty && !isLoading && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className="w-full max-w-xl mx-auto my-auto py-12 sm:py-20 flex flex-col items-center text-center px-4"
            >
              {/* Brand Icon & Heading */}
              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl bg-red-50 border border-red-100 flex items-center justify-center text-red-600 shadow-sm mb-4">
                <ColletMark size={32} />
              </div>
              <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-neutral-900 leading-tight">
                HAINBUCH <span className="text-red-600">Technical Advisor</span>
              </h1>
              <p className="text-xs sm:text-sm text-neutral-500 leading-relaxed mt-2 max-w-md">
                Präzise Auslegung von Spannmitteln, Passungsberechnung nach ISO 286, Schnittdaten und Rüstzeitoptimierung.
              </p>

              {/* Drawing Upload Button */}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="mt-6 inline-flex items-center gap-2.5 px-5 py-2.5 rounded-2xl border-2 border-dashed border-red-200 hover:border-red-500 bg-red-50/50 hover:bg-red-50 text-xs sm:text-sm font-bold text-neutral-800 hover:text-red-700 transition-all shadow-sm group cursor-pointer"
              >
                <Upload size={16} className="text-red-600 group-hover:scale-110 transition-transform shrink-0" />
                <span>{t.uploadCta}</span>
              </button>

              {/* Trust badge */}
              <p className="flex items-center justify-center gap-1.5 text-[11px] text-neutral-400 mt-6">
                <ShieldCheck size={12} className="shrink-0 text-neutral-400" />
                <span>{t.trustLine}</span>
              </p>
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
          {queuedMessages.length > 0 && (
            <div className="measure mb-2 flex flex-col gap-1">
              {queuedMessages.map((qm, idx) => (
                <div key={idx} className="flex items-center justify-between px-3 py-1.5 bg-neutral-100 border border-neutral-200 rounded-lg text-xs text-neutral-600 shadow-sm">
                  <div className="flex items-center gap-2 truncate">
                    <span className="font-semibold text-red-600 shrink-0">#{idx + 1} In Warteschlange:</span>
                    <span className="truncate text-neutral-800">{qm.text || qm.file?.name || 'Zeichnung'}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setQueuedMessages(prev => prev.filter((_, i) => i !== idx))}
                    className="text-neutral-400 hover:text-red-600 transition-colors ml-2 shrink-0 p-0.5 rounded"
                    title={t.remove}
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
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
                const file = e.target.files?.[0] ?? null;
                if (file) {
                  if (isEmpty && !isLoading) {
                    void executeSubmit('', file);
                  } else {
                    setAttachedFile(file);
                  }
                }
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              title={t.drawingAttached}
              className={`flex items-center justify-center w-9 h-9 rounded-full transition-colors shrink-0 mb-0.5 ${
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
                  void handleSubmit(e);
                }
              }}
              placeholder={
                dragging
                  ? t.dropHint
                  : isLoading
                    ? 'Nachricht eingeben (wird in die Warteschlange gestellt)...'
                    : t.inputPlaceholder
              }
              className="composer-input flex-1 bg-transparent text-sm placeholder:text-neutral-400 focus:outline-none px-2 py-2 mobile-input overflow-y-auto scroll-thin"
            />
            {isLoading && (
              <button
                type="button"
                onClick={stopGeneration}
                title="Generierung stoppen (Esc)"
                aria-label="Generierung stoppen (Esc)"
                className="flex items-center justify-center w-9 h-9 rounded-full bg-neutral-100 text-neutral-600 hover:bg-red-50 hover:text-red-600 transition-colors shrink-0 mb-0.5"
              >
                <Square size={13} className="fill-current" />
              </button>
            )}
            <button
              type="submit"
              disabled={!inputValue.trim() && !attachedFile}
              aria-label={isLoading ? "In Warteschlange einreihen" : "Senden"}
              title={isLoading ? "In Warteschlange einreihen" : "Senden"}
              className="send-btn flex items-center justify-center w-9 h-9 rounded-full bg-red-600 text-white hover:bg-red-700 disabled:opacity-30 transition-colors shrink-0 mb-0.5"
            >
              {isLoading ? <ListPlus size={16} /> : <Send size={16} className="ml-0.5" />}
            </button>
          </form>
          {/* Trust + legal footer (desktop only — phones need the room) */}
          <div className="measure no-print mt-1.5 hidden sm:flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 text-[10px] text-neutral-400">
            <span className="inline-flex items-center gap-1">
              <ShieldCheck size={10} className="shrink-0" />
              {t.trustLine}
            </span>
            <span className="flex items-center gap-3">
              <a href="https://shop.hainbuch.com" target="_blank" rel="noopener noreferrer" className="hover:text-red-600 transition-colors">Shop</a>
              <a href="https://www.hainbuch.com/en/legal-notice/site-notice/" target="_blank" rel="noopener noreferrer" className="hover:text-red-600 transition-colors">Impressum</a>
              <a href="https://shop.hainbuch.com/privacy" target="_blank" rel="noopener noreferrer" className="hover:text-red-600 transition-colors">Datenschutz</a>
            </span>
          </div>
        </div>
      </div>

      {activeSetupSheet && (
        <Suspense fallback={null}>
        <SetupSheetModal
          isOpen={!!activeSetupSheet}
          onClose={() => setActiveSetupSheet(null)}
          data={activeSetupSheet}
        />
        </Suspense>
      )}

      {showRoiModal && (
        <Suspense fallback={null}>
        <RoiTimeCalculatorModal
          isOpen={showRoiModal}
          onClose={() => setShowRoiModal(false)}
        />
        </Suspense>
      )}

      {showAuth && (
        <Suspense fallback={null}>
        <AuthModal
          t={t}
          initialCountry={profile.country || geoCountry}
          onClose={() => setShowAuth(false)}
          onSaved={handleAuthSaved}
        />
        </Suspense>
      )}

      {showCountry && (
        <Suspense fallback={null}>
        <CountryLangPicker
          t={t}
          country={profile.country}
          lang={uiLang}
          onClose={() => setShowCountry(false)}
          onPick={handleCountryPick}
        />
        </Suspense>
      )}

      {showHistory && (
      <Suspense fallback={null}>
      <HistorySidebar
        open={showHistory}
        t={t}
        items={histItems}
        loading={histLoading}
        activeId={conversationId}
        onClose={() => setShowHistory(false)}
        onOpen={(id) => { void openConversation(id); }}
        onRename={(id, title) => {
          void renameHist(id, title).then((ok) => { if (ok) void refreshHistList(); });
        }}
        onDelete={(id) => {
          void deleteHist(id).then((ok) => {
            if (ok) {
              if (conversationId === id) resetChat();
              void refreshHistList();
            }
          });
        }}
        onNew={() => { resetChat(); setShowHistory(false); }}
      />
      </Suspense>
      )}

      {/* Lightbox / Technische Zeichnung Vergrößerung */}
      {previewImage && (
        <div
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 animate-fade-in"
          onClick={() => setPreviewImage(null)}
        >
          <div className="relative max-w-5xl max-h-[90vh] flex flex-col items-center" onClick={e => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setPreviewImage(null)}
              className="absolute -top-11 right-0 text-white/80 hover:text-white bg-white/10 hover:bg-white/20 rounded-full p-2 transition-colors cursor-pointer"
              title="Schließen (Klick außerhalb schließt ebenfalls)"
            >
              <X size={20} />
            </button>
            <img
              src={previewImage}
              alt="Technische Zeichnung vergrößert"
              className="max-h-[85vh] max-w-full rounded-xl shadow-2xl object-contain bg-white border border-neutral-800"
            />
          </div>
        </div>
      )}

    </div>
  );
}
