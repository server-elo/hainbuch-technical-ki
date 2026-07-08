import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, Loader2, Circle } from 'lucide-react';
import type { PipelineStatus } from '../types';
import { FACTS_BY_LANG } from '../facts';
import { T, type UiLang } from '../i18n';

const STAGE_KEYS = ['retrieval-material', 'material', 'retrieval-catalog', 'plan', 'calc'];

function useElapsed(startedAt: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((now - startedAt) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function FactCarousel({ lang }: { lang: UiLang }) {
  const FACTS = FACTS_BY_LANG[lang] || FACTS_BY_LANG.de;
  // always open with the time-savings teaser, then rotate
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % FACTS.length), 8000);
    return () => clearInterval(t);
  }, [FACTS.length]);
  const fact = FACTS[idx % FACTS.length];
  return (
    <div className="relative overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50 p-4 min-h-[110px]">
      <AnimatePresence mode="wait">
        <motion.div
          key={idx}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.35 }}
        >
          <span className="text-[10px] font-semibold uppercase tracking-widest text-red-600">
            {fact.tag}
          </span>
          <p className="text-sm font-semibold text-neutral-900 mt-1 mb-1">{fact.title}</p>
          <p className="text-xs text-neutral-500 leading-relaxed">{fact.text}</p>
        </motion.div>
      </AnimatePresence>
      <div className="absolute bottom-2.5 right-3 flex gap-1">
        {FACTS.map((_, i) => (
          <span
            key={i}
            className={`h-1 rounded-full transition-all ${i === idx ? 'w-4 bg-red-600' : 'w-1 bg-neutral-300'}`}
          />
        ))}
      </div>
    </div>
  );
}

export default function WaitingPanel({ status, lang = 'de' }: { status: PipelineStatus; lang?: UiLang }) {
  const t = T[lang];
  const STAGES = STAGE_KEYS.map((key, i) => ({ key, label: t.stages[i] }));
  const elapsed = useElapsed(status.startedAt);
  const activeIdx = STAGES.findIndex((s) => s.key === status.stage);

  return (
    <div className="w-full max-w-md space-y-4">
      <div className="rounded-lg border border-neutral-200 bg-white p-5">
        <div className="flex items-center justify-between mb-4">
          <span className="text-xs font-semibold uppercase tracking-widest text-neutral-500">
            {t.waitTitle}
          </span>
          <span className="text-xs font-mono text-neutral-400">{elapsed}</span>
        </div>
        <ul className="space-y-3">
          {STAGES.map((s, i) => {
            const done = activeIdx > i;
            const active = activeIdx === i;
            return (
              <li key={s.key} className="flex items-center gap-2.5 text-sm">
                {done ? (
                  <CheckCircle2 size={15} className="text-green-600 shrink-0" />
                ) : active ? (
                  <Loader2 size={15} className="text-red-600 animate-spin shrink-0" />
                ) : (
                  <Circle size={15} className="text-neutral-300 shrink-0" />
                )}
                <span className={done ? 'text-neutral-400' : active ? 'text-neutral-900 font-medium' : 'text-neutral-400'}>
                  {s.label}
                </span>
              </li>
            );
          })}
        </ul>
        {status.infos.length > 0 && (
          <div className="mt-4 pt-3 border-t border-neutral-100 space-y-1">
            {status.infos.slice(-3).map((info, i) => (
              <p key={i} className="text-xs text-green-700 flex items-start gap-1.5">
                <span className="mt-0.5">›</span>
                {info}
              </p>
            ))}
          </div>
        )}
      </div>
      <FactCarousel lang={lang} />
      <p className="text-[11px] text-neutral-400 text-center">
        {t.waitHint}
      </p>
    </div>
  );
}
