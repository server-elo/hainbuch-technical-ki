import React, { useState } from 'react';
import { X, Mail, User as UserIcon, Globe, Loader2, LogIn, UserPlus } from 'lucide-react';
import { T } from '../i18n';
import { COUNTRIES } from '../lib/profile';
import { syncProfile } from '../lib/historyApi';

type Strings = (typeof T)[keyof typeof T];

export interface AuthResult {
  email: string;
  displayName: string;
  country: string;
  token: string;
}

export default function AuthModal({ t, initialCountry, onClose, onSaved }: {
  t: Strings;
  initialCountry: string;
  onClose: () => void;
  onSaved: (r: AuthResult) => void;
}) {
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [country, setCountry] = useState(initialCountry || '');
  const [terms, setTerms] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const switchMode = (m: 'login' | 'register') => {
    setMode(m);
    setError('');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      setError('E-Mail');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'register' && !terms) {
        setError('!TERMS!');
        setBusy(false);
        return;
      }
      const j = await syncProfile(mode === 'login'
        ? { email: email.trim(), loginOnly: true }
        : {
            email: email.trim(), displayName: name.trim(), country,
            consentTerms: true, consentMarketing: marketing,
          });
      onSaved({
        email: j.user.email || email.trim(),
        displayName: mode === 'login' ? (j.user.displayName || '') : name.trim(),
        country: mode === 'login' ? (j.user.country || '') : country,
        token: j.token,
      });
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      setError(status === 404 ? '!NOTREG!' : status === 400 ? '!TERMS!' : '!OFFLINE!');
    } finally {
      setBusy(false);
    }
  };

  const tab = (m: 'login' | 'register', label: string, Icon: typeof LogIn) => (
    <button
      type="button" onClick={() => switchMode(m)}
      className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-bold rounded-xl transition-colors ${
        mode === m ? 'bg-red-600 text-white shadow-sm' : 'text-neutral-500 hover:text-neutral-800 hover:bg-neutral-100'
      }`}
    >
      <Icon size={13} /> {label}
    </button>
  );

  return (
    <div
      role="dialog" aria-modal="true" aria-label={t.authTitle}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
    >
      <form
        onSubmit={submit}
        className="bg-white text-neutral-900 w-full max-w-sm rounded-2xl shadow-2xl border border-neutral-200 p-5 sm:p-6"
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-bold tracking-tight">{t.authTitle}</h2>
            <p className="text-xs text-neutral-500 mt-1 leading-relaxed">{t.authSub}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t.cancel}
            className="p-1.5 text-neutral-400 hover:text-neutral-700 rounded-lg hover:bg-neutral-100 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="mt-4 flex gap-1.5 p-1 bg-neutral-100 rounded-xl">
          {tab('register', t.register, UserPlus)}
          {tab('login', t.login, LogIn)}
        </div>

        {mode === 'register' ? (
          <>
            <label className="block mt-4 text-xs font-semibold text-neutral-600">
              <span className="flex items-center gap-1.5 mb-1"><UserIcon size={12} /> {t.name}</span>
              <input
                value={name} onChange={(e) => setName(e.target.value)} maxLength={80}
                placeholder={t.name} autoComplete="name"
                className="w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
              />
            </label>

            <label className="block mt-3 text-xs font-semibold text-neutral-600">
              <span className="flex items-center gap-1.5 mb-1"><Mail size={12} /> {t.email} *</span>
              <input
                value={email} onChange={(e) => setEmail(e.target.value)} maxLength={160}
                placeholder="name@firma.de" inputMode="email" autoComplete="email" required
                className="w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
              />
            </label>

            <label className="block mt-3 text-xs font-semibold text-neutral-600">
              <span className="flex items-center gap-1.5 mb-1"><Globe size={12} /> {t.country}</span>
              <select
                value={country} onChange={(e) => setCountry(e.target.value)}
                className="w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm bg-white outline-none focus:border-red-500"
              >
                <option value="">—</option>
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>{c.name}</option>
                ))}
              </select>
            </label>

            <label className="mt-3 flex items-start gap-2 text-xs text-neutral-600 cursor-pointer">
              <input
                type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-red-600"
              />
              <span>{t.consentTerms}</span>
            </label>

            <label className="mt-2 flex items-start gap-2 text-xs text-neutral-600 cursor-pointer">
              <input
                type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-red-600"
              />
              <span>{t.consentMarketing}</span>
            </label>

          </>
        ) : (
          <>
            <label className="block mt-4 text-xs font-semibold text-neutral-600">
              <span className="flex items-center gap-1.5 mb-1"><Mail size={12} /> {t.email} *</span>
              <input
                value={email} onChange={(e) => setEmail(e.target.value)} maxLength={160}
                placeholder="name@firma.de" inputMode="email" autoComplete="email" required
                className="w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
              />
            </label>
            <p className="mt-2 text-[11px] text-neutral-400 leading-relaxed">{t.haveAccountNote}</p>
          </>
        )}

        {error && (
          <p className="mt-3 text-xs font-medium text-red-600">
            {error === '!OFFLINE!' ? t.errorOffline : error === '!NOTREG!' ? t.notRegistered : error === '!TERMS!' ? t.termsRequired : `${t.email}: ${email || '—'}`}
          </p>
        )}

        <button
          type="submit" disabled={busy}
          className="mt-4 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm"
        >
          {busy && <Loader2 size={14} className="animate-spin" />}
          {mode === 'login' ? t.login : t.continueBtn}
        </button>
        <button
          type="button" onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}
          className="mt-2 w-full text-center text-xs text-neutral-500 hover:text-red-600 transition-colors"
        >
          {mode === 'login' ? t.needAccount : t.haveAccount}
        </button>
        <p className="mt-2 text-[10px] text-neutral-400 leading-relaxed">{t.dataNote}</p>
      </form>
    </div>
  );
}
