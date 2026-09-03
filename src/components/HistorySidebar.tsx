import React, { useState } from 'react';
import { X, Search, Pencil, Trash2, MessageSquarePlus, Loader2, History } from 'lucide-react';
import { T } from '../i18n';
import type { HistoryItem } from '../lib/historyApi';

type Strings = (typeof T)[keyof typeof T];

export default function HistorySidebar({ open, t, items, loading, activeId, onClose, onOpen, onRename, onDelete, onNew }: {
  open: boolean;
  t: Strings;
  items: HistoryItem[];
  loading: boolean;
  activeId: string | null;
  onClose: () => void;
  onOpen: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
}) {
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editVal, setEditVal] = useState('');
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  if (!open) return null;
  const list = items.filter((x) => !q || x.title.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label={t.history}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <aside className="absolute left-0 top-0 bottom-0 w-[300px] max-w-[85vw] bg-white border-r border-neutral-200 shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200">
          <h2 className="text-sm font-bold flex items-center gap-2">
            <History size={15} className="text-red-600" /> {t.history}
          </h2>
          <div className="flex items-center gap-1">
            <button onClick={onNew} title={t.newChat} aria-label={t.newChat}
              className="p-2 text-neutral-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors">
              <MessageSquarePlus size={16} />
            </button>
            <button onClick={onClose} aria-label={t.cancel}
              className="p-2 text-neutral-500 hover:text-neutral-800 hover:bg-neutral-100 rounded-lg transition-colors">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="px-3 pt-3">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.historySearch}
              className="w-full rounded-xl border border-neutral-300 pl-8 pr-3 py-2 text-xs outline-none focus:border-red-500"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto scroll-thin p-3 space-y-1">
          {loading && (
            <p className="flex items-center gap-2 text-xs text-neutral-400 px-2 py-4">
              <Loader2 size={13} className="animate-spin" /> …
            </p>
          )}
          {!loading && list.length === 0 && (
            <p className="text-xs text-neutral-400 px-2 py-4 leading-relaxed">{t.historyEmpty}</p>
          )}
          {list.map((x) => (
            <div
              key={x.id}
              className={`group rounded-xl border px-3 py-2 transition-colors ${
                activeId === x.id ? 'border-red-300 bg-red-50/60' : 'border-transparent hover:bg-neutral-50'
              }`}
            >
              {editing === x.id ? (
                <form
                  onSubmit={(e) => { e.preventDefault(); onRename(x.id, editVal.trim() || x.title); setEditing(null); }}
                  className="flex items-center gap-1"
                >
                  <input
                    value={editVal} onChange={(e) => setEditVal(e.target.value)} autoFocus maxLength={120}
                    className="flex-1 min-w-0 rounded-lg border border-red-300 px-2 py-1 text-xs outline-none"
                  />
                  <button type="submit" className="px-2 py-1 text-xs font-semibold text-red-600">{t.save}</button>
                </form>
              ) : confirmDel === x.id ? (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-neutral-600 truncate">{t.deleteSure}</span>
                  <span className="flex gap-1 shrink-0">
                    <button onClick={() => { onDelete(x.id); setConfirmDel(null); }}
                      className="px-2 py-1 text-xs font-semibold text-white bg-red-600 rounded-lg">{t.delete}</button>
                    <button onClick={() => setConfirmDel(null)}
                      className="px-2 py-1 text-xs text-neutral-500">{t.cancel}</button>
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  <button onClick={() => onOpen(x.id)} className="flex-1 min-w-0 text-left">
                    <span className="block text-xs font-medium text-neutral-800 truncate">{x.title}</span>
                    <span className="block text-[10px] text-neutral-400">
                      {new Date(x.updated_at.replace(' ', 'T') + 'Z').toLocaleDateString()} · {Math.max(1, Math.round(x.message_count / 2))}
                    </span>
                  </button>
                  <button
                    onClick={() => { setEditing(x.id); setEditVal(x.title); }} title={t.rename}
                    className="p-1.5 text-neutral-300 hover:text-neutral-600 opacity-0 group-hover:opacity-100 transition-all">
                    <Pencil size={12} />
                  </button>
                  <button
                    onClick={() => setConfirmDel(x.id)} title={t.delete}
                    className="p-1.5 text-neutral-300 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-all">
                    <Trash2 size={12} />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}
