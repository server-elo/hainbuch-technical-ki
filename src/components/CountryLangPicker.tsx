import React, { useState } from 'react';
import { X, Globe, Check } from 'lucide-react';
import type { UiLang } from '../i18n';
import { T } from '../i18n';
import { COUNTRIES, LANG_NAMES, suggestedLangFor } from '../lib/profile';

type Strings = (typeof T)[keyof typeof T];

const LANGS: UiLang[] = ['de', 'en', 'zh', 'es', 'fr', 'it', 'tr'];

export default function CountryLangPicker({ t, country, lang, onClose, onPick }: {
  t: Strings;
  country: string;
  lang: UiLang;
  onClose: () => void;
  onPick: (country: string, lang: UiLang) => void;
}) {
  const [c, setC] = useState(country);
  const [l, setL] = useState<UiLang>(lang);
  const [q, setQ] = useState('');

  const pickCountry = (code: string) => {
    setC(code);
    const s = suggestedLangFor(code);
    if (s) setL(s);
  };

  const list = COUNTRIES.filter((x) =>
    !q || x.name.toLowerCase().includes(q.toLowerCase()) || x.code.includes(q.toUpperCase()));

  return (
    <div
      role="dialog" aria-modal="true" aria-label={`${t.country} / ${t.language}`}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
    >
      <div className="bg-white text-neutral-900 w-full max-w-md rounded-2xl shadow-2xl border border-neutral-200 p-5 sm:p-6 max-h-[85dvh] flex flex-col">
        <div className="flex items-start justify-between gap-2 shrink-0">
          <div>
            <h2 className="text-base font-bold tracking-tight flex items-center gap-2">
              <Globe size={16} className="text-red-600" /> {t.country} / {t.language}
            </h2>
          </div>
          <button onClick={onClose} aria-label={t.cancel}
            className="p-1.5 text-neutral-400 hover:text-neutral-700 rounded-lg hover:bg-neutral-100 transition-colors">
            <X size={18} />
          </button>
        </div>

        <input
          value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.historySearch}
          className="mt-3 shrink-0 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-red-500"
        />

        <div className="mt-2 grid grid-cols-2 gap-1.5 overflow-y-auto scroll-thin pr-1" style={{ maxHeight: 260 }}>
          {list.map((x) => (
            <button
              key={x.code} onClick={() => pickCountry(x.code)}
              className={`flex items-center justify-between gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition-colors ${
                c === x.code ? 'border-red-500 bg-red-50 text-red-700' : 'border-neutral-200 hover:border-neutral-400 text-neutral-700'
              }`}
            >
              <span className="truncate">{x.name}</span>
              {c === x.code && <Check size={13} className="shrink-0" />}
            </button>
          ))}
        </div>

        <p className="mt-4 text-xs font-semibold text-neutral-600">{t.language}</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {LANGS.map((x) => (
            <button
              key={x} onClick={() => setL(x)}
              className={`px-3 py-1.5 rounded-full border text-xs font-semibold transition-colors ${
                l === x ? 'border-red-500 bg-red-600 text-white' : 'border-neutral-300 text-neutral-600 hover:border-red-400'
              }`}
            >
              {LANG_NAMES[x]}
            </button>
          ))}
        </div>

        <button
          onClick={() => { onPick(c, l); onClose(); }}
          className="mt-4 w-full px-4 py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm"
        >
          {t.save}
        </button>
      </div>
    </div>
  );
}
