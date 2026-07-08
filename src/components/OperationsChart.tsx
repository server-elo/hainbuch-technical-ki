import { motion } from 'motion/react';
import type { ManufacturingOperation } from '../types';

const TYPE_COLORS: Record<string, string> = {
  drehen: '#dc2626',
  fräsen: '#0284c7',
  bohren: '#7c3aed',
  senken: '#ea580c',
  reiben: '#059669',
  gewindebohren: '#db2777',
};

function timeMin(op: ManufacturingOperation): number {
  const m = /([\d.,]+)/.exec(op.time);
  return m ? parseFloat(m[1].replace(',', '.')) : 0;
}

/** Horizontal bar chart of machining time per operation. */
export default function OperationsChart({ operations, title = 'Zeitverteilung' }: { operations: ManufacturingOperation[]; title?: string }) {
  const times = operations.map(timeMin);
  const max = Math.max(...times, 0.01);
  const total = times.reduce((a, b) => a + b, 0);

  return (
    <div className="border border-neutral-200 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h4 className="text-[11px] text-neutral-400 font-semibold uppercase tracking-wider">
          {title}
        </h4>
        <div className="flex flex-wrap gap-2.5">
          {[...new Set(operations.map((o) => o.operationType))].map((t) => (
            <span key={t} className="flex items-center gap-1 text-[10px] text-neutral-500 capitalize">
              <span className="w-2 h-2 rounded-sm" style={{ background: TYPE_COLORS[t] || '#999' }} />
              {t}
            </span>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        {operations.map((op, i) => {
          const t = times[i];
          const pct = (t / max) * 100;
          const share = total > 0 ? (t / total) * 100 : 0;
          return (
            <div key={i} className="grid grid-cols-[minmax(90px,1.2fr)_3fr_auto] items-center gap-2">
              <span className="text-[11px] text-neutral-600 truncate" title={op.stepName}>
                {op.stepName}
              </span>
              <div className="h-4 bg-neutral-100 rounded overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.6, delay: i * 0.08 }}
                  className="h-full rounded"
                  style={{ background: TYPE_COLORS[op.operationType] || '#999' }}
                />
              </div>
              <span className="text-[11px] font-mono text-neutral-500 w-24 text-right">
                {op.time} · {share.toFixed(0)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
