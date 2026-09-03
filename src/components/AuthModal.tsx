import React, { useState } from 'react';
import { X, Mail, Lock, Eye, EyeOff, User as UserIcon, Globe, Loader2, LogIn, UserPlus } from 'lucide-react';
import { T } from '../i18n';
import { COUNTRIES } from '../lib/profile';
import { syncProfile } from '../lib/historyApi';
import { firebaseConfigured, signInWithGoogle, syncWithFirebase } from '../lib/firebase';

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
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [country, setCountry] = useState(initialCountry || '');
  const [terms, setTerms] = useState(false);
  const [marketing, setMarketing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const switchMode = (m: 'login' | 'register') => {
    setMode(m);
    setError('');
  };

  /** Google sign-in (only rendered when Firebase is configured). */
  const google = async () => {
    if (busy) return;
    if (mode === 'register' && !terms) {
      setError('!TERMS!');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const g = await signInWithGoogle();
      const j = await syncWithFirebase({
        idToken: g.idToken,
        displayName: name.trim() || g.displayName,
        country,
        consentTerms: mode === 'register',
        consentMarketing: marketing,
      });
      onSaved({
        email: j.user.email || g.email,
        displayName: j.user.displayName || g.displayName,
        country: j.user.country || country,
        token: j.token,
      });
    } catch (err: unknown) {
      const code = (err as { code?: string; status?: number }).code;
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
      const status = (err as { status?: number }).status;
      setError(status === 404 ? '!NOTREG!' : status === 400 ? '!TERMS!' : '!OFFLINE!');
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    const cleanEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleanEmail)) {
      setError('!EMAIL!');
      return;
    }
    if (!password || password.length < 6) {
      setError('!PWDLEN!');
      return;
    }
    if (mode === 'register' && !terms) {
      setError('!TERMS!');
      return;
    }
    setBusy(true);
    try {
      const j = await syncProfile(mode === 'login'
        ? { email: cleanEmail, password, loginOnly: true }
        : {
            email: cleanEmail, password, displayName: name.trim(), country,
            consentTerms: true, consentMarketing: marketing,
          });
      onSaved({
        email: j.user.email || cleanEmail,
        displayName: mode === 'login' ? (j.user.displayName || '') : name.trim(),
        country: mode === 'login' ? (j.user.country || '') : country,
        token: j.token,
      });
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      if (status === 401) {
        setError('!WRONGPWD!');
      } else if (status === 404) {
        setError('!NOTREG!');
      } else if (status === 409) {
        setError('!ALREADYREG!');
      } else if (status === 400) {
        setError('!PWDLEN!');
      } else {
        setError('!OFFLINE!');
      }
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-fade-in"
    >
      <form
        onSubmit={submit}
        className="bg-white text-neutral-900 w-full max-w-sm rounded-2xl shadow-2xl border border-neutral-200 p-5 sm:p-6"
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="text-base font-bold tracking-tight">
              {mode === 'login' ? 'HAINBUCH Anmeldung' : t.authTitle}
            </h2>
            <p className="text-xs text-neutral-500 mt-1 leading-relaxed">
              {mode === 'login' ? 'Melden Sie sich mit E-Mail & Passwort an, um Ihre Chat-Historie und Auslegungen zu sichern.' : t.authSub}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label={t.cancel}
            className="p-1.5 text-neutral-400 hover:text-neutral-700 rounded-lg hover:bg-neutral-100 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="mt-4 flex gap-1.5 p-1 bg-neutral-100 rounded-xl">
          {tab('login', t.login || 'Anmelden', LogIn)}
          {tab('register', t.register || 'Registrieren', UserPlus)}
        </div>

        {mode === 'register' ? (
          <>
            <label className="block mt-4 text-xs font-semibold text-neutral-600">
              <span className="flex items-center gap-1.5 mb-1"><UserIcon size={12} /> {t.name}</span>
              <input
                value={name} onChange={(e) => setName(e.target.value)} maxLength={80}
                placeholder="Vorname Nachname" autoComplete="name"
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
              <span className="flex items-center gap-1.5 mb-1"><Lock size={12} /> Passwort *</span>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password} onChange={(e) => setPassword(e.target.value)} maxLength={100}
                  placeholder="Mindestens 6 Zeichen" autoComplete="new-password" required
                  className="w-full rounded-xl border border-neutral-300 px-3 py-2 pr-9 text-sm outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
                />
                <button
                  type="button" onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 transition-colors"
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
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

            <label className="block mt-3 text-xs font-semibold text-neutral-600">
              <span className="flex items-center gap-1.5 mb-1"><Lock size={12} /> Passwort *</span>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password} onChange={(e) => setPassword(e.target.value)} maxLength={100}
                  placeholder="Ihr Passwort" autoComplete="current-password" required
                  className="w-full rounded-xl border border-neutral-300 px-3 py-2 pr-9 text-sm outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
                />
                <button
                  type="button" onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 transition-colors"
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </label>
          </>
        )}

        {error && (
          <div className="mt-3 p-2.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-medium">
            {error === '!WRONGPWD!'
              ? 'Falsches Passwort. Bitte überprüfen Sie Ihre Eingabe.'
              : error === '!PWDLEN!'
                ? 'Das Passwort muss mindestens 6 Zeichen lang sein.'
                : error === '!NOTREG!'
                  ? 'Kein Konto mit dieser E-Mail gefunden. Bitte wechseln Sie auf "Registrieren".'
                  : error === '!ALREADYREG!'
                    ? 'Diese E-Mail ist bereits registriert. Bitte wechseln Sie auf "Anmelden".'
                    : error === '!TERMS!'
                      ? 'Bitte stimmen Sie den Nutzungsbedingungen zu.'
                      : error === '!EMAIL!'
                        ? 'Bitte geben Sie eine gültige E-Mail-Adresse ein.'
                        : error === '!OFFLINE!'
                          ? 'Server nicht erreichbar. Bitte versuchen Sie es gleich erneut.'
                          : error}
          </div>
        )}

        <button
          type="submit" disabled={busy}
          className="mt-4 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors shadow-sm cursor-pointer"
        >
          {busy && <Loader2 size={14} className="animate-spin" />}
          {mode === 'login' ? (t.login || 'Anmelden') : (t.continueBtn || 'Registrieren')}
        </button>
        {firebaseConfigured && (
          <>
            <div className="mt-3 flex items-center gap-2 text-[11px] text-neutral-400">
              <span className="flex-1 border-t border-neutral-200" />
              <span>{t.or}</span>
              <span className="flex-1 border-t border-neutral-200" />
            </div>
            <button
              type="button" onClick={google} disabled={busy}
              className="mt-3 w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-white hover:bg-neutral-50 disabled:opacity-50 text-neutral-800 text-sm font-semibold rounded-xl transition-colors border border-neutral-300 shadow-sm cursor-pointer"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                <path fill="#4285F4" d="M23.5 12.3c0-.9-.1-1.5-.3-2.3H12v4.5h6.5c-.1 1.1-.8 2.7-2.4 3.8l-.1.7 3.5 2.7.2.1c2.2-2 3.8-5 3.8-9.5z" />
                <path fill="#34A853" d="M12 24c3.2 0 6-1.1 7.9-2.9l-3.8-2.9c-1 .7-2.9 1.7-4.1 1.7-3.2 0-5.9-2.1-6.8-5l-.7.1-2.8 2.2-.1.6C3.5 21.5 7.5 24 12 24z" />
                <path fill="#FBBC05" d="M5.2 14.9c-.2-.7-.4-1.6-.4-2.9s.1-2.1.4-2.9l-.1-.6-2.8-2.2-.5.3C.6 8.2 0 10 0 12s.6 3.8 1.7 5.4l3.5-2.5z" />
                <path fill="#EA4335" d="M12 4.7c1.8 0 3 .8 3.7 1.4l3.3-3.2C17.9 1.1 15.2 0 12 0 7.5 0 3.5 2.5 1.7 6.6l3.5 2.8c1-2.9 3.7-4.7 6.8-4.7z" />
              </svg>
              Google
            </button>
          </>
        )}
        <button
          type="button" onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}
          className="mt-3 w-full text-center text-xs text-neutral-500 hover:text-red-600 transition-colors cursor-pointer"
        >
          {mode === 'login' ? 'Noch kein Konto? Hier registrieren' : 'Bereits registriert? Hier anmelden'}
        </button>
        <p className="mt-2 text-[10px] text-neutral-400 leading-relaxed text-center">{t.dataNote}</p>
      </form>
    </div>
  );
}
