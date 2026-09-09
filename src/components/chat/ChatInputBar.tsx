import React, { useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Send, Loader2, FileText, Image as ImageIcon, Paperclip, X,
  Square, ListPlus, ShieldCheck, Lock, LogIn, ArrowDown
} from 'lucide-react';
import { T, type UiLang } from '../../i18n';

export interface ChatInputBarProps {
  t: (typeof T)[keyof typeof T];
  uiLang: UiLang;
  isAuth: boolean;
  isLoading: boolean;
  atBottom: boolean;
  onScrollToBottom: () => void;
  queuedMessages: { text: string; file: File | null }[];
  onRemoveQueuedMessage: (idx: number) => void;
  attachedFile: File | null;
  onRemoveAttachedFile: () => void;
  inputValue: string;
  onInputChange: (val: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onStopGeneration: () => void;
  onAttachFile: (file: File) => void;
  onOpenAuth: () => void;
  dragging: boolean;
  setDragging: (d: boolean) => void;
}

export function ChatInputBar({
  t,
  uiLang,
  isAuth,
  isLoading,
  atBottom,
  onScrollToBottom,
  queuedMessages,
  onRemoveQueuedMessage,
  attachedFile,
  onRemoveAttachedFile,
  inputValue,
  onInputChange,
  onSubmit,
  onStopGeneration,
  onAttachFile,
  onOpenAuth,
  dragging,
  setDragging,
}: ChatInputBarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow textarea up to CSS max-height
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [inputValue]);

  const acceptDrop = (f: File | undefined) => {
    if (!f) return;
    const ext = '.' + (f.name.split('.').pop() || '').toLowerCase();
    if (
      f.type.startsWith('image/') ||
      ['image/*'].includes(f.type) ||
      ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif', '.heic', '.heif', '.jfif', '.svg', '.dxf', '.pdf'].includes(ext)
    ) {
      onAttachFile(f);
    }
  };

  return (
    <div className="composer-wrap relative px-3 sm:px-6 pt-3 sm:pt-4 bg-white border-t border-neutral-200 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:pb-4">
      <AnimatePresence>
        {!atBottom && (
          <motion.button
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            onClick={onScrollToBottom}
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
            <div
              key={idx}
              className="flex items-center justify-between px-3 py-1.5 bg-neutral-100 border border-neutral-200 rounded-lg text-xs text-neutral-600 shadow-sm"
            >
              <div className="flex items-center gap-2 truncate">
                <span className="font-semibold text-red-600 shrink-0">#{idx + 1} In Warteschlange:</span>
                <span className="truncate text-neutral-800">{qm.text || qm.file?.name || 'Zeichnung'}</span>
              </div>
              <button
                type="button"
                onClick={() => onRemoveQueuedMessage(idx)}
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
        <div className="measure mb-2 flex">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-neutral-50 border border-neutral-200 rounded-lg text-xs text-neutral-600 w-fit max-w-full">
            {/\.pdf$/i.test(attachedFile.name) ? (
              <FileText size={13} className="text-red-600 shrink-0" />
            ) : (
              <ImageIcon size={13} className="text-red-600 shrink-0" />
            )}
            <span className="truncate">{attachedFile.name}</span>
            <button
              type="button"
              onClick={onRemoveAttachedFile}
              className="text-neutral-400 hover:text-red-600 transition-colors shrink-0"
              title={t.remove}
            >
              <X size={13} />
            </button>
          </div>
        </div>
      )}

      {!isAuth && (
        <div
          onClick={onOpenAuth}
          className="measure no-print mb-2 px-3.5 py-2 bg-gradient-to-r from-red-50/80 via-white to-neutral-50 border border-red-200/80 hover:border-red-300 rounded-xl flex items-center justify-between gap-3 shadow-xs cursor-pointer transition-all hover:shadow-sm group"
        >
          <div className="flex items-center gap-2.5 text-xs text-neutral-700 min-w-0">
            <div className="w-6 h-6 rounded-full bg-red-100 text-red-600 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
              <Lock size={12} />
            </div>
            <span className="font-medium truncate">
              {uiLang === 'de'
                ? 'Anmelden oder registrieren, um dem Technical Advisor zu schreiben'
                : 'Log in or register to message the Technical Advisor'}
            </span>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenAuth();
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg shadow-xs transition-colors shrink-0 cursor-pointer"
          >
            <LogIn size={12} />
            <span>{t.login} / {t.register}</span>
          </button>
        </div>
      )}

      <form
        onSubmit={onSubmit}
        onDragOver={(e) => {
          e.preventDefault();
          if (!dragging) setDragging(true);
        }}
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
            if (file) onAttachFile(file);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          onClick={() => {
            if (!isAuth) {
              onOpenAuth();
              return;
            }
            fileInputRef.current?.click();
          }}
          title={t.drawingAttached}
          className={`flex items-center justify-center w-9 h-9 rounded-full transition-colors shrink-0 mb-0.5 cursor-pointer ${
            attachedFile ? 'text-red-600 bg-red-50' : 'text-neutral-400 hover:text-red-600 hover:bg-neutral-100'
          }`}
        >
          <Paperclip size={16} />
        </button>
        <textarea
          ref={inputRef}
          rows={1}
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void onSubmit(e);
            }
          }}
          placeholder={
            dragging
              ? t.dropHint
              : !isAuth
                ? (uiLang === 'de'
                    ? 'Nachricht an den Technical Advisor schreiben (Anmeldung erforderlich)...'
                    : 'Message the Technical Advisor (Sign in required)...')
                : isLoading
                  ? 'Nachricht eingeben (wird in die Warteschlange gestellt)...'
                  : t.inputPlaceholder
          }
          className="composer-input flex-1 bg-transparent text-sm placeholder:text-neutral-400 focus:outline-none px-2 py-2 mobile-input overflow-y-auto scroll-thin"
        />
        {isLoading && (
          <button
            type="button"
            onClick={onStopGeneration}
            title="Generierung stoppen (Esc)"
            aria-label="Generierung stoppen (Esc)"
            className="flex items-center justify-center w-9 h-9 rounded-full bg-neutral-100 text-neutral-600 hover:bg-red-50 hover:text-red-600 transition-colors shrink-0 mb-0.5 cursor-pointer"
          >
            <Square size={13} className="fill-current" />
          </button>
        )}
        <button
          type="submit"
          disabled={isAuth && !inputValue.trim() && !attachedFile}
          aria-label={!isAuth ? `${t.login} / ${t.register}` : (isLoading ? 'In Warteschlange einreihen' : 'Senden')}
          title={!isAuth ? `${t.login} / ${t.register}` : (isLoading ? 'In Warteschlange einreihen' : 'Senden')}
          className="send-btn flex items-center justify-center w-9 h-9 rounded-full bg-red-600 text-white hover:bg-red-700 disabled:opacity-30 transition-colors shrink-0 mb-0.5 cursor-pointer"
        >
          {!isAuth ? <Lock size={15} /> : (isLoading ? <ListPlus size={16} /> : <Send size={16} className="ml-0.5" />)}
        </button>
      </form>

      {/* Trust + legal footer (desktop only) */}
      <div className="measure no-print mt-1.5 hidden sm:flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 text-[10px] text-neutral-400">
        <span className="inline-flex items-center gap-1">
          <ShieldCheck size={10} className="shrink-0" />
          {t.trustLine}
        </span>
        <span className="flex items-center gap-3">
          <a href="https://shop.hainbuch.com" target="_blank" rel="noopener noreferrer" className="hover:text-red-600 transition-colors">
            Shop
          </a>
          <a href="https://www.hainbuch.com/en/legal-notice/site-notice/" target="_blank" rel="noopener noreferrer" className="hover:text-red-600 transition-colors">
            Impressum
          </a>
          <a href="https://shop.hainbuch.com/privacy" target="_blank" rel="noopener noreferrer" className="hover:text-red-600 transition-colors">
            Datenschutz
          </a>
        </span>
      </div>
    </div>
  );
}

export default ChatInputBar;
