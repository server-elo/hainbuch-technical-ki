import React, { useState, useRef, useEffect, Suspense } from 'react';
import { motion } from 'motion/react';
import { ChevronDown, X } from 'lucide-react';
import type { ChatMessage } from './types';
import WaitingPanel, { FactCarousel } from './components/WaitingPanel';
import type { SetupSheetData } from './components/SetupSheetModal';
import { MachineProfile, PRESET_MACHINES } from './components/MachineSelector';
import { convertFileToBase64 } from './utils';

// Custom hooks
import { useProfileAuth } from './hooks/useProfileAuth';
import { useChatStream } from './hooks/useChatStream';
import { useHistoryManager } from './hooks/useHistoryManager';
import { useMachineHint } from './hooks/useMachineHint';

// Chat components
import ColletMark from './components/chat/ColletMark';
import ThinkingIndicator from './components/chat/ThinkingIndicator';
import ChatMessageItem from './components/chat/ChatMessageItem';
import ChatHeader from './components/chat/ChatHeader';
import ChatInputBar from './components/chat/ChatInputBar';
import EmptyChatView from './components/chat/EmptyChatView';

// Below-the-fold modals: split into chunks, loaded on demand
const SetupSheetModal = React.lazy(() => import('./components/SetupSheetModal'));
const RoiTimeCalculatorModal = React.lazy(() => import('./components/RoiTimeCalculatorModal'));
const AuthModal = React.lazy(() => import('./components/AuthModal'));
const CountryLangPicker = React.lazy(() => import('./components/CountryLangPicker'));
const HistorySidebar = React.lazy(() => import('./components/HistorySidebar'));

export default function App() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [selectedMachine, setSelectedMachine] = useState<MachineProfile>(PRESET_MACHINES[0]);
  const [catalogMode, setCatalogMode] = useState<boolean>(() => {
    try { return localStorage.getItem('hb-catalog-mode') !== '0'; } catch { return true; }
  });

  const toggleCatalogMode = () => {
    setCatalogMode(v => {
      try { localStorage.setItem('hb-catalog-mode', v ? '0' : '1'); } catch { /* ignore */ }
      return !v;
    });
  };

  // Modals & UI state
  const [activeSetupSheet, setActiveSetupSheet] = useState<SetupSheetData | null>(null);
  const [showRoiModal, setShowRoiModal] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [pendingSubmit, setPendingSubmit] = useState<{ text: string; file: File | null } | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const [dragging, setDragging] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Profile and Auth
  const {
    profile,
    uiLang,
    geoCountry,
    t,
    showAuth,
    setShowAuth,
    showCountry,
    setShowCountry,
    isAuth,
    handleAuthSaved,
    handleLogout: authLogout,
    handleCountryPick,
  } = useProfileAuth(() => resetChat());

  // Chat Streaming
  const {
    messages,
    setMessages,
    messagesRef,
    isLoading,
    pipeline,
    showProgress,
    setShowProgress,
    queuedMessages,
    setQueuedMessages,
    lastRequestRef,
    sendChat,
    stopGeneration,
    retryLast,
    resetChat: hookResetChat,
  } = useChatStream({
    selectedMachine,
    catalogMode,
    profile,
    uiLang,
    t,
    conversationId,
    setConversationId,
  });

  const resetChat = () => {
    hookResetChat();
    setInputValue('');
    setAttachedFile(null);
  };

  const handleLogout = () => {
    authLogout();
    setHistItems([]);
    resetChat();
  };

  // History Manager
  const {
    showHistory,
    setShowHistory,
    histItems,
    setHistItems,
    histLoading,
    refreshHistList,
    openHistoryPanel,
    openConversation,
    handleRenameHist,
    handleDeleteHist,
  } = useHistoryManager({
    profile,
    conversationId,
    setConversationId,
    setMessages,
    stopGeneration,
    resetChat,
  });

  // Machine Auto-Detect
  const {
    machineHint,
    processMachineDetection,
    applyMachineHint,
    undoMachineHint,
    dismissMachineHint,
  } = useMachineHint({
    selectedMachine,
    setSelectedMachine,
  });

  // Hotkey: Escape clears attachment or aborts generation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isLoading) {
          e.preventDefault();
          stopGeneration();
        } else if (attachedFile) {
          setAttachedFile(null);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isLoading, attachedFile, stopGeneration]);

  // Auto-scroll
  useEffect(() => {
    if (atBottom) messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading, atBottom]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Title update
  const answerCount = messages.filter(m => m.role === 'model' && (m.analysis || m.error)).length;
  useEffect(() => {
    document.title = answerCount > 0
      ? `(${answerCount}) HAINBUCH Technical Advisor`
      : 'HAINBUCH Technical Advisor';
  }, [answerCount]);

  // Submit handler
  const executeSubmit = async (text: string, file: File | null) => {
    if (!text.trim() && !file) return;
    if (!isAuth()) {
      setPendingSubmit({ text, file });
      setShowAuth(true);
      return;
    }
    const parts: ChatMessage['parts'] = [];
    if (file) {
      try {
        const { base64, mimeType } = await convertFileToBase64(file);
        parts.push({ inlineData: { data: base64, mimeType } });
        const defaultPrompt = uiLang === 'de'
          ? 'Bitte analysiere diese technische Zeichnung vollständig: Geometrie, Maße, Toleranzen, Passungen nach ISO 286, Werkstoffempfehlung und passende HAINBUCH-Spannmittel.'
          : 'Please analyze this technical drawing completely: geometry, dimensions, tolerances, ISO 286 fits, material recommendation, and suitable HAINBUCH workholding solutions.';
        parts.push({ text: text.trim() || defaultPrompt });
      } catch (err) {
        console.error('File attach failed:', err);
      }
    } else if (text.trim()) {
      parts.push({ text: text.trim() });
    }
    if (parts.length === 0) return;

    const machineForRequest = processMachineDetection(text);
    const nextMsgs = [...messagesRef.current, { role: 'user' as const, parts }];
    messagesRef.current = nextMsgs;
    setMessages(nextMsgs);
    lastRequestRef.current = nextMsgs;
    void sendChat(nextMsgs, machineForRequest);
  };

  // Queue runner
  useEffect(() => {
    if (!isLoading && queuedMessages.length > 0) {
      const nextItem = queuedMessages[0];
      setQueuedMessages(prev => prev.slice(1));
      void executeSubmit(nextItem.text, nextItem.file);
    }
  }, [isLoading, queuedMessages, setQueuedMessages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim() && !attachedFile) {
      if (!isAuth()) setShowAuth(true);
      return;
    }
    if (!isAuth()) {
      setPendingSubmit({ text: inputValue, file: attachedFile });
      setShowAuth(true);
      return;
    }
    if (isLoading) {
      setQueuedMessages(prev => [...prev, { text: inputValue, file: attachedFile }]);
      setInputValue('');
      setAttachedFile(null);
      return;
    }
    const text = inputValue;
    const file = attachedFile;
    setInputValue('');
    setAttachedFile(null);
    await executeSubmit(text, file);
  };

  const onAuthSaved = (r: { email: string; displayName: string; country: string; token: string }) => {
    handleAuthSaved(r);
    void refreshHistList();
    if (pendingSubmit) {
      const ps = pendingSubmit;
      setPendingSubmit(null);
      setInputValue('');
      setAttachedFile(null);
      setTimeout(() => { void executeSubmit(ps.text, ps.file); }, 50);
    }
  };

  const acceptDrop = (f: File | undefined) => {
    if (!f) return;
    const ext = '.' + (f.name.split('.').pop() || '').toLowerCase();
    if (
      f.type.startsWith('image/') ||
      ['image/*'].includes(f.type) ||
      ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif', '.heic', '.heif', '.jfif', '.svg', '.dxf', '.pdf'].includes(ext)
    ) {
      if (!isAuth()) {
        setPendingSubmit({ text: '', file: f });
        setShowAuth(true);
        return;
      }
      if (messages.length === 1 && !isLoading) {
        void executeSubmit('', f);
      } else {
        setAttachedFile(f);
      }
    }
  };

  const isEmpty = messages.length === 1;

  return (
    <div className="app-root h-[100dvh] bg-white text-neutral-800 flex flex-col overflow-hidden font-sans">
      <div
        className="chat-column w-full flex flex-col flex-1 min-h-0 mobile-chat relative"
        onDragOver={e => { e.preventDefault(); if (!dragging) setDragging(true); }}
        onDragLeave={e => { if (e.currentTarget === e.target) setDragging(false); }}
        onDrop={e => {
          e.preventDefault();
          setDragging(false);
          acceptDrop(e.dataTransfer.files?.[0]);
        }}
      >
        {dragging && (
          <div className="absolute inset-0 z-50 no-print flex items-center justify-center bg-red-600/10 backdrop-blur-[2px] border-4 border-dashed border-red-600 rounded-lg m-2 pointer-events-none">
            <div className="bg-white rounded-xl px-5 py-3 shadow-lg font-semibold text-red-600 text-sm">
              Bild / Zeichnung hier ablegen
            </div>
          </div>
        )}

        <ChatHeader
          t={t}
          profile={profile}
          isEmpty={isEmpty}
          isLoading={isLoading}
          catalogMode={catalogMode}
          onToggleCatalogMode={toggleCatalogMode}
          selectedMachine={selectedMachine}
          onSelectMachine={setSelectedMachine}
          machineHint={machineHint}
          onApplyMachineHint={applyMachineHint}
          onUndoMachineHint={undoMachineHint}
          onDismissMachineHint={dismissMachineHint}
          onOpenHistory={() => (profile.email || profile.token ? openHistoryPanel() : setShowAuth(true))}
          onOpenCountry={() => setShowCountry(true)}
          onOpenAuth={() => setShowAuth(true)}
          onLogout={handleLogout}
          onResetChat={resetChat}
          onOpenRoiModal={() => setShowRoiModal(true)}
        />

        {isLoading && pipeline && (
          <div className="relative z-20">
            <button
              onClick={() => setShowProgress(s => !s)}
              className="w-full text-left bg-white border-b border-neutral-200 hover:bg-neutral-50 transition-colors"
            >
              <div className="h-0.5 bg-neutral-100 overflow-hidden">
                <div
                  className="h-full bg-red-600 transition-all duration-700 relative overflow-hidden progress-sheen"
                  style={{
                    width: `${
                      {
                        intent: 5,
                        drawing: 12,
                        chat: 55,
                        'retrieval-material': 22,
                        material: 40,
                        'retrieval-catalog': 58,
                        plan: 78,
                        calc: 93,
                      }[pipeline.stage] ?? 10
                    }%`,
                  }}
                />
              </div>
              <div className="flex items-center justify-between px-4 py-1">
                <span className="text-[10px] text-neutral-400 truncate">
                  {pipeline.label || t.analyzing}
                </span>
                <ChevronDown size={11} className={`text-neutral-300 transition-transform shrink-0 ${showProgress ? 'rotate-180' : ''}`} />
              </div>
            </button>
            {showProgress && (
              <div className="absolute top-full left-0 right-0 bg-white border-b border-neutral-200 shadow-lg p-4 flex justify-center">
                <WaitingPanel status={pipeline} lang={uiLang} />
              </div>
            )}
          </div>
        )}

        <div ref={scrollRef} className="scroll-thin flex-1 overflow-y-auto px-3 sm:px-6 py-4 sm:py-6 bg-neutral-50" style={{ minHeight: 0 }}>
          <div className="measure space-y-5">
            {!isEmpty &&
              messages.map((msg, index) => (
                <ChatMessageItem
                  key={index}
                  msg={msg}
                  index={index}
                  t={t}
                  uiLang={uiLang}
                  conversationId={conversationId}
                  onRetryLast={retryLast}
                  onPreviewImage={setPreviewImage}
                  onOpenSetupSheet={setActiveSetupSheet}
                />
              ))}

            {isEmpty && !isLoading && (
              <EmptyChatView
                t={t}
                onUploadClick={() => {
                  if (!isAuth()) {
                    setShowAuth(true);
                    return;
                  }
                  fileInputRef.current?.click();
                }}
              />
            )}

            {isLoading && pipeline && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-3">
                <div className="hidden sm:flex w-8 h-8 rounded-full bg-red-600 items-center justify-center shrink-0 text-white">
                  <ColletMark size={17} />
                </div>
                <div className="pt-2 flex-1 min-w-0 max-w-md space-y-3">
                  <ThinkingIndicator pipeline={pipeline} fallback={t.waitTitle} />
                  <FactCarousel lang={uiLang} />
                </div>
              </motion.div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        <ChatInputBar
          t={t}
          uiLang={uiLang}
          isAuth={isAuth()}
          isLoading={isLoading}
          atBottom={atBottom}
          onScrollToBottom={() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })}
          queuedMessages={queuedMessages}
          onRemoveQueuedMessage={idx => setQueuedMessages(prev => prev.filter((_, i) => i !== idx))}
          attachedFile={attachedFile}
          onRemoveAttachedFile={() => setAttachedFile(null)}
          inputValue={inputValue}
          onInputChange={setInputValue}
          onSubmit={handleSubmit}
          onStopGeneration={stopGeneration}
          onAttachFile={acceptDrop}
          onOpenAuth={() => setShowAuth(true)}
          dragging={dragging}
          setDragging={setDragging}
        />
      </div>

      {activeSetupSheet && (
        <Suspense fallback={null}>
          <SetupSheetModal isOpen={!!activeSetupSheet} onClose={() => setActiveSetupSheet(null)} data={activeSetupSheet} />
        </Suspense>
      )}

      {showRoiModal && (
        <Suspense fallback={null}>
          <RoiTimeCalculatorModal isOpen={showRoiModal} onClose={() => setShowRoiModal(false)} />
        </Suspense>
      )}

      {showAuth && (
        <Suspense fallback={null}>
          <AuthModal t={t} initialCountry={profile.country || geoCountry} onClose={() => setShowAuth(false)} onSaved={onAuthSaved} />
        </Suspense>
      )}

      {showCountry && (
        <Suspense fallback={null}>
          <CountryLangPicker t={t} country={profile.country} lang={uiLang} onClose={() => setShowCountry(false)} onPick={handleCountryPick} />
        </Suspense>
      )}

      {showHistory && (
        <Suspense fallback={null}>
          <HistorySidebar
            open={showHistory}
            t={t}
            items={histItems}
            loading={histLoading}
            activeId={conversationId}
            onClose={() => setShowHistory(false)}
            onOpen={id => { void openConversation(id); }}
            onRename={handleRenameHist}
            onDelete={handleDeleteHist}
            onNew={() => { resetChat(); setShowHistory(false); }}
          />
        </Suspense>
      )}

      {previewImage && (
        <div
          className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 animate-fade-in"
          onClick={() => setPreviewImage(null)}
        >
          <div className="relative max-w-5xl max-h-[90vh] flex flex-col items-center" onClick={e => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setPreviewImage(null)}
              className="absolute -top-11 right-0 text-white/80 hover:text-white bg-white/10 hover:bg-white/20 rounded-full p-2 transition-colors cursor-pointer"
              title="Schließen"
            >
              <X size={20} />
            </button>
            <img
              src={previewImage}
              alt="Technische Zeichnung vergrößert"
              className="max-h-[85vh] max-w-full rounded-xl shadow-2xl object-contain bg-white border border-neutral-800"
            />
          </div>
        </div>
      )}
    </div>
  );
}
