import React, { useState, useId } from 'react';
import { ChevronDown, Clock, TrendingDown, ArrowRight } from 'lucide-react';
import type { ChatMessage } from '../../types';
import { T, type UiLang } from '../../i18n';
import { num, eur } from '../../format';
import { resolveImgUrl } from '../../utils';
import OperationsChart from '../OperationsChart';
import FitDiagram from '../FitDiagram';

/** Collapsible answer section with anchor id (long Auslegungen stay navigable). */
export function Section({
  id,
  title,
  accent,
  defaultOpen,
  children,
}: {
  id?: string;
  title: React.ReactNode;
  accent?: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div id={id} className="border border-neutral-200 rounded-lg bg-white overflow-hidden scroll-mt-28">
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-2 px-3 sm:px-4 py-2.5 sm:py-3 text-left hover:bg-neutral-50/60 transition-colors"
      >
        <h4 className={`text-[11px] font-semibold uppercase tracking-wider ${accent ? 'text-red-600' : 'text-neutral-400'}`}>
          {title}
        </h4>
        <ChevronDown size={14} className={`text-neutral-400 transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="px-3 sm:px-4 pb-3 sm:pb-4">{children}</div>}
    </div>
  );
}

/** Structured pipeline result (fits, plan, cutting data, products) shown under the message. */
export function AnalysisBlock({
  analysis,
  t,
  lang,
}: {
  analysis: NonNullable<ChatMessage['analysis']>;
  t: (typeof T)[keyof typeof T];
  lang: UiLang;
}) {
  const ma = analysis.manufacturingAnalysis;
  const recs = analysis.recommendations;
  const fits = analysis.fitSolutions;
  const uid = useId().replace(/:/g, '');
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
            <a
              key={n.id}
              href={`#${n.id}`}
              className="text-[10px] font-semibold uppercase tracking-wider text-neutral-500 hover:text-red-600 bg-white border border-neutral-200 hover:border-red-300 rounded-full px-2.5 py-1 transition-colors"
            >
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
              <h4 className="text-[11px] text-neutral-400 font-semibold uppercase tracking-wider mb-1 flex items-center gap-1.5">
                <Clock size={11} /> {t.fastest}
              </h4>
              <p className="text-xs text-neutral-600 leading-relaxed">{ma.fastestMethod}</p>
            </div>
            <div className="border border-neutral-200 rounded-lg p-4 bg-white">
              <h4 className="text-[11px] text-neutral-400 font-semibold uppercase tracking-wider mb-1 flex items-center gap-1.5">
                <TrendingDown size={11} /> {t.economic}
              </h4>
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
                target="_blank"
                rel="noopener noreferrer"
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

export default AnalysisBlock;
