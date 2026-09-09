import React, { useState, useEffect, useRef } from 'react';
import {
  User, History, Globe, LogIn, LogOut, PenLine, Sparkles, X, Clock, BookOpen, Zap
} from 'lucide-react';
import { T } from '../../i18n';
import { API_BASE } from '../../config';
import type { Profile } from '../../lib/profile';
import MachineSelector, { MachineProfile } from '../MachineSelector';
import ColletMark from './ColletMark';

export function StatusDot({ onlineLabel, limitedLabel }: { onlineLabel: string; limitedLabel: string }) {
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

export interface ChatHeaderProps {
  t: (typeof T)[keyof typeof T];
  profile: Profile;
  isEmpty: boolean;
  isLoading: boolean;
  catalogMode: boolean;
  onToggleCatalogMode: () => void;
  selectedMachine: MachineProfile;
  onSelectMachine: (m: MachineProfile) => void;
  machineHint: { preset: MachineProfile; auto: boolean } | null;
  onApplyMachineHint: () => void;
  onUndoMachineHint: () => void;
  onDismissMachineHint: () => void;
  onOpenHistory: () => void;
  onOpenCountry: () => void;
  onOpenAuth: () => void;
  onLogout: () => void;
  onResetChat: () => void;
  onOpenRoiModal: () => void;
}

export function ChatHeader({
  t,
  profile,
  isEmpty,
  isLoading,
  catalogMode,
  onToggleCatalogMode,
  selectedMachine,
  onSelectMachine,
  machineHint,
  onApplyMachineHint,
  onUndoMachineHint,
  onDismissMachineHint,
  onOpenHistory,
  onOpenCountry,
  onOpenAuth,
  onLogout,
  onResetChat,
  onOpenRoiModal,
}: ChatHeaderProps) {
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
      if (e.key === 'Escape') {
        setShowAccount(false);
        setConfirmLogout(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [showAccount]);

  return (
    <>
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
            onClick={onOpenHistory}
            title={t.history}
            aria-label={t.history}
            className="flex items-center gap-1 text-xs text-neutral-600 hover:text-red-600 transition-colors rounded-xl px-2.5 py-1.5 bg-white border border-neutral-200/90 hover:border-red-300 shadow-sm h-9"
          >
            <History size={14} className="shrink-0" />
          </button>
          <button
            onClick={onOpenCountry}
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
                aria-haspopup="menu"
                aria-expanded={showAccount}
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
                    onClick={() => { setShowAccount(false); setConfirmLogout(false); onOpenHistory(); }}
                    className="w-full flex items-center gap-2 px-2.5 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-100 rounded-lg transition-colors"
                  >
                    <History size={14} className="text-neutral-400" /> {t.history}
                  </button>
                  {confirmLogout ? (
                    <div className="px-2.5 py-2">
                      <p className="text-xs font-semibold text-neutral-800 mb-2">{t.logoutSure}</p>
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => { setShowAccount(false); setConfirmLogout(false); onLogout(); }}
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
              onClick={onOpenAuth}
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
              onClick={onResetChat}
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

      {/* Context toolbar: machine profile + ROI calculator + catalog mode toggle */}
      <div className="no-print shrink-0 border-b border-neutral-100 bg-white/95 backdrop-blur relative z-30 overflow-visible">
        <div className="measure flex items-center gap-2 px-3 sm:px-6 py-1.5 relative overflow-visible">
          <MachineSelector selected={selectedMachine} onSelect={onSelectMachine} />
          {machineHint && (
            <div className="flex items-center gap-1.5 px-2.5 h-9 rounded-xl bg-red-50 border border-red-200 text-xs shrink-0 max-w-[70vw] sm:max-w-none">
              <Sparkles size={13} className="text-red-600 shrink-0" />
              <span className="font-semibold text-neutral-700 truncate">{t.machineDetected}: {machineHint.preset.name}</span>
              {machineHint.auto ? (
                <button onClick={onUndoMachineHint} className="font-bold text-red-700 hover:text-red-900 shrink-0">{t.undoMachine}</button>
              ) : (
                <button onClick={onApplyMachineHint} className="font-bold text-red-700 hover:text-red-900 shrink-0">{t.applyMachine}</button>
              )}
              <button onClick={onDismissMachineHint} aria-label={t.cancel} className="text-neutral-400 hover:text-neutral-700 shrink-0">
                <X size={13} />
              </button>
            </div>
          )}
          <button
            onClick={onOpenRoiModal}
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-xl bg-white hover:bg-neutral-50 border border-neutral-300/90 hover:border-red-600 shadow-sm hover:shadow text-xs font-semibold text-neutral-800 hover:text-red-700 transition-all group h-9 shrink-0 cursor-pointer"
            title="Wirtschaftlichkeits- & Zeitrechner öffnen"
          >
            <Clock size={14} className="text-red-600 group-hover:rotate-45 transition-transform shrink-0" />
            <span className="hidden xs:inline">Zeitrechner</span>
          </button>
          <button
            onClick={onToggleCatalogMode}
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
    </>
  );
}

export default ChatHeader;
