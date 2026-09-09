import React, { useState, useEffect } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { T } from '../../i18n';

/** Live countdown from Retry-After seconds ("in 42 Min" / "in 3 Std 12 Min"). */
export function RetryCountdown({ sec, t }: { sec: number; t: (typeof T)[keyof typeof T] }) {
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
export function ErrorBubble({
  kind,
  retryAfterSec,
  onRetry,
  t,
}: {
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

export default ErrorBubble;
