import React from 'react';
import { motion } from 'motion/react';
import { Upload, ShieldCheck } from 'lucide-react';
import { T } from '../../i18n';
import ColletMark from './ColletMark';

export interface EmptyChatViewProps {
  t: (typeof T)[keyof typeof T];
  onUploadClick: () => void;
}

export function EmptyChatView({ t, onUploadClick }: EmptyChatViewProps) {
  return (
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
        onClick={onUploadClick}
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
  );
}

export default EmptyChatView;
