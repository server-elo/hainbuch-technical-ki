import React from 'react';
import { motion } from 'motion/react';
import { User, FileText, Image as ImageIcon } from 'lucide-react';
import type { ChatMessage } from '../../types';
import { T, type UiLang } from '../../i18n';
import { parseSetupSheetFromMarkdown } from '../../utils';
import type { SetupSheetData } from '../SetupSheetModal';
import ColletMark from './ColletMark';
import MessageText from './MessageText';
import AnalysisBlock from './AnalysisBlock';
import ErrorBubble from './ErrorBubble';
import { FeedbackButtons, PdfButton, CopyButton, messageToText } from './MessageActions';

export interface ChatMessageItemProps {
  msg: ChatMessage;
  index: number;
  t: (typeof T)[keyof typeof T];
  uiLang: UiLang;
  conversationId?: string | null;
  onRetryLast: () => void;
  onPreviewImage: (src: string) => void;
  onOpenSetupSheet: (sheet: SetupSheetData) => void;
}

export function ChatMessageItem({
  msg,
  index,
  t,
  uiLang,
  conversationId,
  onRetryLast,
  onPreviewImage,
  onOpenSetupSheet,
}: ChatMessageItemProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`msg-group flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
    >
      <div
        className={`hidden sm:flex w-8 h-8 rounded-full items-center justify-center shrink-0 ${
          msg.role === 'user'
            ? 'bg-neutral-100 text-neutral-700 border border-neutral-200 shadow-sm'
            : 'bg-red-600 text-white shadow-sm'
        }`}
      >
        {msg.role === 'user' ? <User size={15} /> : <ColletMark size={17} />}
      </div>
      <div
        className={`message-bubble ${msg.role === 'user' ? 'user' : 'model'} ${
          msg.analysis ? 'max-w-full sm:max-w-[85%] flex-1' : 'max-w-[88%] sm:max-w-[75%]'
        } rounded-2xl px-3.5 sm:px-4 py-3 ${msg.error ? '!border-red-200 !bg-red-50/60' : ''}`}
      >
        {msg.error ? (
          <ErrorBubble
            kind={msg.error.kind}
            retryAfterSec={msg.error.retryAfterSec}
            onRetry={onRetryLast}
            t={t}
          />
        ) : (
          <>
            {msg.parts.map((part, pIdx) => (
              <div key={pIdx}>
                {(index === 0 && msg.role === 'model' ? true : !!part.text) && (
                  <MessageText text={index === 0 && msg.role === 'model' ? t.welcome : (part.text || '')} />
                )}
                {part.inlineData && (
                  part.inlineData.mimeType.startsWith('image/') ? (
                    <div className="mt-2.5 rounded-xl overflow-hidden border border-neutral-200/90 shadow-sm max-w-sm bg-white group">
                      <img
                        src={`data:${part.inlineData.mimeType};base64,${part.inlineData.data}`}
                        alt="Hochgeladene technische Zeichnung"
                        className="w-full max-h-64 object-contain bg-neutral-50/60 cursor-pointer group-hover:scale-[1.01] transition-transform duration-200"
                        onClick={() => onPreviewImage(`data:${part.inlineData!.mimeType};base64,${part.inlineData!.data}`)}
                      />
                      <div
                        className="px-3 py-1.5 bg-white border-t border-neutral-100 flex items-center justify-between text-xs text-neutral-600 cursor-pointer"
                        onClick={() => onPreviewImage(`data:${part.inlineData!.mimeType};base64,${part.inlineData!.data}`)}
                      >
                        <span className="flex items-center gap-1.5 font-medium text-neutral-700">
                          <ImageIcon size={14} className="text-red-600 shrink-0" />
                          {t.drawingAttached || 'Zeichnung'}
                        </span>
                        <span className="text-[11px] text-neutral-400 group-hover:text-red-600 transition-colors">
                          Vergrößern 🔍
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 p-2 bg-neutral-50 rounded flex items-center gap-2 border border-neutral-200 text-xs text-neutral-500">
                      {part.inlineData.mimeType === 'application/pdf' ? <FileText size={14} /> : <ImageIcon size={14} />}
                      {part.inlineData.mimeType === 'application/pdf' ? t.pdfAttached : t.drawingAttached}
                    </div>
                  )
                )}
              </div>
            ))}
          </>
        )}
        {msg.analysis && <AnalysisBlock analysis={msg.analysis} t={t} lang={uiLang} />}
        {msg.role === 'model' && index > 0 && !msg.error && (
          <div className="msg-actions no-print mt-2.5 flex flex-wrap justify-end items-center gap-2">
            <button
              onClick={() => {
                const text = msg.parts.map(p => p.text).join('\n');
                const sheet = parseSetupSheetFromMarkdown(text);
                if (sheet) onOpenSetupSheet(sheet);
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-white hover:bg-red-50 text-neutral-800 hover:text-red-700 transition-all border border-neutral-300 hover:border-red-600 shadow-sm group"
              title="Werkstatt-Einrichteblatt öffnen & als DIN A4 PDF drucken"
            >
              <FileText size={14} className="text-red-600 group-hover:scale-110 transition-transform shrink-0" />
              <span>Einrichteblatt (PDF)</span>
            </button>
            <FeedbackButtons getText={() => messageToText(msg, t)} conversationId={conversationId} />
            {msg.analysis && <PdfButton msg={msg} t={t} />}
            <CopyButton getText={() => messageToText(msg, t)} labels={{ copy: t.copy, copied: t.copied }} />
          </div>
        )}
      </div>
    </motion.div>
  );
}

export default ChatMessageItem;
