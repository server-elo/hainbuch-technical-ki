import React, { useState, useRef, useEffect } from 'react';
import {
  Send, Bot, User, ChevronRight, ChevronDown, Loader2, FileText,
  Image as ImageIcon, Clock, TrendingDown, Ruler, BookOpen,
  Calculator, Grab
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { ChatMessage, Recommendation, AssessmentData, ManufacturingAnalysis, FitSolution, PipelineStatus } from './types';
import AssessmentForm from './components/AssessmentForm';
import WaitingPanel from './components/WaitingPanel';
import { T, useUiLang } from './i18n';
import { API_BASE, apiHeaders } from './config';
import OperationsChart from './components/OperationsChart';
import FitDiagram from './components/FitDiagram';

const FEATURE_ICONS = [BookOpen, Calculator, Ruler, Grab];

/** ChatGPT-style collapsible "thinking" indicator with scrolling event log. */
function ThinkingIndicator({ pipeline }: { pipeline: PipelineStatus }) {
  const [open, setOpen] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [pipeline.log.length, open]);

  const latest = pipeline.log[pipeline.log.length - 1] || 'Analyse läuft…';

  return (
    <div className="max-w-[85%]">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-neutral-400 hover:text-neutral-600 transition-colors group"
      >
        <Loader2 size={11} className="animate-spin text-red-600 shrink-0" />
        <span className="text-[10px] font-medium animate-pulse">
          {open ? 'Analyse läuft' : latest}
        </span>
        <ChevronRight
          size={10}
          className={`shrink-0 transition-transform text-neutral-300 group-hover:text-neutral-500 ${open ? 'rotate-90' : ''}`}
        />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div
              ref={logRef}
              className="mt-1.5 ml-4 pl-3 border-l-2 border-neutral-200 max-h-32 overflow-y-auto space-y-1"
            >
              {pipeline.log.map((line, i) => (
                <p
                  key={i}
                  className={`text-[10px] leading-relaxed ${
                    i === pipeline.log.length - 1 ? 'text-neutral-500' : 'text-neutral-400'
                  }`}
                >
                  {line}
                </p>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Minimal markdown renderer for assistant messages (###, **bold**, bullets). */
function MessageText({ text }: { text: string }) {
  const renderInline = (s: string) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith('**') && part.endsWith('**') ? (
        <strong key={i} className="font-semibold text-neutral-900">{part.slice(2, -2)}</strong>
      ) : (
        part
      )
    );

  return (
    <div className="text-sm leading-relaxed space-y-1.5">
      {text.split('\n').map((line, i) => {
        const t = line.trim();
        if (!t) return <div key={i} className="h-1" />;
        if (t.startsWith('###')) {
          return (
            <p key={i} className="font-semibold text-neutral-900 mt-2">
              {t.replace(/^#+\s*/, '')}
            </p>
          );
        }
        if (/^[-•]\s/.test(t)) {
          return (
            <p key={i} className="pl-4 relative">
              <span className="absolute left-1 text-red-600">•</span>
              {renderInline(t.replace(/^[-•]\s/, ''))}
            </p>
          );
        }
        return <p key={i}>{renderInline(line)}</p>;
      })}
    </div>
  );
}

function StatusDot({ onlineLabel, limitedLabel }: { onlineLabel: string; limitedLabel: string }) {
  const [online, setOnline] = useState<boolean | null>(null);
  useEffect(() => {
    const load = () =>
      fetch(`${API_BASE}/api/status`)
        .then(r => r.json())
        .then(s => setOnline(s.llmOnline && s.ragOnline))
        .catch(() => setOnline(false));
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);
  if (online === null) return null;
  return (
    <span className="hidden sm:flex items-center gap-1.5 text-xs text-neutral-500">
      <span className={`w-2 h-2 rounded-full ${online ? 'bg-green-500' : 'bg-neutral-300'}`} />
      {online ? onlineLabel : limitedLabel}
    </span>
  );
}

export default function App() {
  const [uiLang, setUiLang] = useUiLang();
  const t = T[uiLang];
  const [messages, setMessages] = useState<ChatMessage[]>([{
    role: "model",
    parts: [{ text: "" }]  // index 0 is always rendered from t.welcome
  }]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentRecommendations, setCurrentRecommendations] = useState<Recommendation[] | null>(null);
  const [currentManufacturingAnalysis, setCurrentManufacturingAnalysis] = useState<ManufacturingAnalysis | null>(null);
  const [currentFits, setCurrentFits] = useState<FitSolution[] | null>(null);
  const [pipeline, setPipeline] = useState<PipelineStatus | null>(null);
  const [showAssessment, setShowAssessment] = useState(false);
  const [showProgress, setShowProgress] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  // Consume the NDJSON pipeline stream: status events update the waiting
  // panel; the final "result" line carries the full analysis.
  const sendChat = async (newMessages: ChatMessage[]) => {
    setIsLoading(true);
    setPipeline({ stage: 'intent', label: '', infos: [], log: [], startedAt: Date.now() });
    try {
      const apiMessages = newMessages.filter((msg, idx) => !(idx === 0 && msg.role === 'model'));
      const response = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({ messages: apiMessages })
      });
      if (!response.ok || !response.body) {
        throw new Error(`Server error (${response.status})`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let result: any = null;
      let errMsg: string | null = null;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          let ev: any;
          try { ev = JSON.parse(line); } catch { continue; }
          if (ev.type === 'status') {
            setPipeline(p => p ? { ...p, stage: ev.stage, label: ev.label, log: [...p.log, ev.label] } : p);
          } else if (ev.type === 'info') {
            setPipeline(p => p ? { ...p, infos: [...p.infos, ev.label], log: [...p.log, ev.label] } : p);
          } else if (ev.type === 'result') {
            result = ev.data;
          } else if (ev.type === 'error') {
            errMsg = ev.error;
          }
        }
      }
      if (errMsg) throw new Error(errMsg);
      if (!result) throw new Error('Keine Antwort erhalten');

      setMessages(prev => [...prev, { role: 'model', parts: [{ text: result.message }] }]);
      if (Array.isArray(result.recommendations)) setCurrentRecommendations(result.recommendations);
      if (result.manufacturingAnalysis && typeof result.manufacturingAnalysis === 'object') {
        setCurrentManufacturingAnalysis(result.manufacturingAnalysis);
      }
      setCurrentFits(
        Array.isArray(result.fitSolutions) && result.fitSolutions.length > 0
          ? result.fitSolutions
          : null
      );
    } catch (error: any) {
      console.error('Chat API Error:', error);
      setMessages(prev => [...prev, {
        role: 'model',
        parts: [{ text: `${t.errorMsg} (${error.message || 'Error'}).` }]
      }]);
    } finally {
      setIsLoading(false);
      setPipeline(null);
      setShowProgress(false);
    }
  };

  const convertFileToBase64 = (file: File): Promise<{base64: string, mimeType: string}> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX = 2048;
          let { width, height } = img;
          if (width > height && width > MAX) {
            height *= MAX / width; width = MAX;
          } else if (height > MAX) {
            width *= MAX / height; height = MAX;
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve({ base64: (reader.result as string).split(',')[1], mimeType: file.type });
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          resolve({ base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' });
        };
        img.onerror = reject;
        img.src = reader.result as string;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleAssessmentSubmit = async (data: AssessmentData, imageFile: File | null) => {
    setShowAssessment(false);

    const assessmentText = `Technische Anforderungen:
- Maschine: ${data.machineType || 'Nicht angegeben'}
- Budget: ${data.budget || 'Nicht angegeben'}
- Anforderungen: ${data.projectRequirements || 'Nicht angegeben'}
- Randbedingungen: ${data.technicalConstraints || 'Keine'}
- Ziele: ${data.desiredOutcomes || 'Keine'}`;

    const parts: ChatMessage['parts'] = [{ text: assessmentText }];
    if (imageFile) {
      const { base64, mimeType } = await convertFileToBase64(imageFile);
      parts.push({ inlineData: { data: base64, mimeType } });
      parts.push({ text: "\n[Technische Zeichnung angehängt]" });
    }

    const newMessages = [...messages, { role: 'user' as const, parts }];
    setMessages(newMessages);
    await sendChat(newMessages);
  };

  const submitText = async (text: string) => {
    if (!text.trim() || isLoading) return;
    const newMessages = [...messages, { role: 'user' as const, parts: [{ text }] }];
    setMessages(newMessages);
    setInputValue('');
    await sendChat(newMessages);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitText(inputValue);
  };

  return (
    <div className="min-h-screen bg-white text-neutral-800 flex flex-col md:flex-row overflow-hidden font-sans" style={{backgroundColor: '#ffffff'}}>

      {/* ── Chat column ─────────────────────────────────────────────── */}
      <div className="w-full md:w-1/2 lg:w-7/12 flex flex-col h-screen border-r border-neutral-200 mobile-chat">
        <header className="px-6 py-4 border-b border-neutral-200 bg-white flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            <span className="text-xl font-black tracking-tight text-red-600">HAINBUCH</span>
            <span className="h-5 w-px bg-neutral-200" />
            <span className="text-sm text-neutral-500">{t.subtitle}</span>
          </div>
          <div className="flex items-center gap-4">
            <select
              value={uiLang}
              onChange={(e) => setUiLang(e.target.value as any)}
              className="text-[11px] font-semibold text-neutral-600 border border-neutral-200 rounded-md px-1.5 py-1 bg-white hover:border-neutral-300 focus:outline-none focus:border-red-600 cursor-pointer"
              title="Sprache / Language"
            >
              <option value="de">DE — Deutsch</option>
              <option value="en">EN — English</option>
              <option value="zh">ZH — 中文</option>
              <option value="es">ES — Español</option>
              <option value="fr">FR — Français</option>
              <option value="it">IT — Italiano</option>
              <option value="tr">TR — Türkçe</option>
            </select>
            <StatusDot onlineLabel={t.online} limitedLabel={t.limited} />
            <button
              onClick={() => setShowAssessment(true)}
              className="flex items-center gap-2 text-sm font-medium bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded transition-colors"
            >
              <FileText size={15} />
              <span className="hidden sm:inline">{t.assessment}</span>
            </button>
          </div>
        </header>

        {isLoading && pipeline && (
          <div className="relative z-20">
            <button
              onClick={() => setShowProgress(s => !s)}
              className="w-full text-left bg-white border-b border-neutral-200 hover:bg-neutral-50 transition-colors"
            >
              <div className="h-0.5 bg-neutral-100 overflow-hidden">
                <div
                  className="h-full bg-red-600 transition-all duration-700"
                  style={{ width: `${{ intent: 5, drawing: 12, chat: 55, 'retrieval-material': 22, material: 40, 'retrieval-catalog': 58, plan: 78, calc: 93 }[pipeline.stage] ?? 10}%` }}
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
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5 bg-neutral-50">
          {messages.map((msg, index) => (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              key={index}
              className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
            >
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                msg.role === 'user' ? 'bg-neutral-200 text-neutral-600' : 'bg-red-600 text-white'
              }`}>
                {msg.role === 'user' ? <User size={15} /> : <Bot size={15} />}
              </div>
              <div className={`max-w-[85%] rounded-xl px-4 py-3 ${
                msg.role === 'user'
                  ? 'bg-neutral-200/70 text-neutral-800'
                  : 'bg-white text-neutral-700 border border-neutral-200 shadow-sm'
              }`}>
                {msg.parts.map((part, pIdx) => (
                  <div key={pIdx}>
                    {(index === 0 && msg.role === 'model' ? true : !!part.text) && (
                      <MessageText text={index === 0 && msg.role === 'model' ? t.welcome : (part.text || '')} />
                    )}
                    {part.inlineData && (
                      <div className="mt-2 p-2 bg-neutral-50 rounded flex items-center gap-2 border border-neutral-200 text-xs text-neutral-500">
                        {part.inlineData.mimeType === 'application/pdf' ? <FileText size={14} /> : <ImageIcon size={14} />}
                        {part.inlineData.mimeType === 'application/pdf' ? t.pdfAttached : t.drawingAttached}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </motion.div>
          ))}
          {isLoading && pipeline && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-red-600 flex items-center justify-center shrink-0 text-white">
                <Bot size={15} />
              </div>
              <div className="pt-2">
                <ThinkingIndicator pipeline={pipeline} />
              </div>
            </motion.div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="px-6 py-4 bg-white border-t border-neutral-200">
          <form onSubmit={handleSubmit} className="relative">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              placeholder={t.inputPlaceholder}
              className="w-full bg-white border border-neutral-300 rounded-lg px-4 py-3.5 pr-13 text-sm placeholder:text-neutral-400 focus:outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600/30 transition-colors mobile-input"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={isLoading || !inputValue.trim()}
              className="absolute right-2 top-2 bottom-2 aspect-square bg-red-600 text-white rounded-md flex items-center justify-center hover:bg-red-700 disabled:opacity-30 transition-colors"
            >
              <Send size={15} className="ml-0.5" />
            </button>
          </form>
        </div>
      </div>

      {/* ── Analysis column ─────────────────────────────────────────── */}
      <div className="w-full md:w-1/2 lg:w-5/12 h-screen overflow-y-auto bg-white p-4 md:p-6 lg:p-8 mobile-chat">
        <AnimatePresence mode="wait">
          {currentRecommendations && currentRecommendations.length > 0 ? (
            <motion.div
              key="recommendations"
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              className="space-y-5 pb-10 recommendation-card"
            >
              <h2 className="text-lg font-bold text-neutral-900">{t.analysisTitle}</h2>

              {currentFits && currentFits.length > 0 && (
                <div className="space-y-4">
                  {currentFits.map((fit, i) => (
                    <FitDiagram key={i} fit={fit} />
                  ))}
                </div>
              )}

              {currentManufacturingAnalysis && (
                <div className="space-y-4">
                  {currentManufacturingAnalysis.material && (
                    <div className="border border-neutral-200 rounded-lg p-4">
                      <h4 className="text-[11px] text-red-600 font-semibold uppercase tracking-wider mb-1">{t.material}</h4>
                      <p className="text-sm text-neutral-900 font-semibold">
                        {currentManufacturingAnalysis.material.name}
                      </p>
                      <p className="text-xs text-neutral-500 mt-1 leading-relaxed">{currentManufacturingAnalysis.material.reasoning}</p>
                      {currentManufacturingAnalysis.rawMaterialRecommendation && (
                        <p className="text-xs text-neutral-600 mt-2">
                          <span className="font-medium">{t.rawMaterial}:</span> {currentManufacturingAnalysis.rawMaterialRecommendation}
                        </p>
                      )}
                    </div>
                  )}

                  <div className="grid sm:grid-cols-2 gap-3">
                    <div className="border border-neutral-200 rounded-lg p-4">
                      <h4 className="text-[11px] text-neutral-400 font-semibold uppercase tracking-wider mb-1 flex items-center gap-1.5"><Clock size={11} /> {t.fastest}</h4>
                      <p className="text-xs text-neutral-600 leading-relaxed">{currentManufacturingAnalysis.fastestMethod}</p>
                    </div>
                    <div className="border border-neutral-200 rounded-lg p-4">
                      <h4 className="text-[11px] text-neutral-400 font-semibold uppercase tracking-wider mb-1 flex items-center gap-1.5"><TrendingDown size={11} /> {t.economic}</h4>
                      <p className="text-xs text-neutral-600 leading-relaxed">{currentManufacturingAnalysis.costEffectiveMethod}</p>
                    </div>
                  </div>

                  {currentManufacturingAnalysis.clampingStrategy && (
                    <div className="border border-neutral-200 rounded-lg p-4">
                      <h4 className="text-[11px] text-neutral-400 font-semibold uppercase tracking-wider mb-1">{t.clamping}</h4>
                      <p className="text-xs text-neutral-600 leading-relaxed">{currentManufacturingAnalysis.clampingStrategy}</p>
                    </div>
                  )}

                  {Array.isArray(currentManufacturingAnalysis.operations) && currentManufacturingAnalysis.operations.length > 1 && (
                    <OperationsChart operations={currentManufacturingAnalysis.operations} />
                  )}

                  <div className="border border-neutral-200 rounded-lg p-4">
                    <h4 className="text-[11px] text-neutral-400 font-semibold uppercase tracking-wider mb-3">{t.plan}</h4>
                    <div className="space-y-3">
                      {Array.isArray(currentManufacturingAnalysis.operations) && currentManufacturingAnalysis.operations.map((op, i) => (
                        <div key={i} className="flex flex-col gap-0.5 border-b border-neutral-100 pb-2.5 last:border-0 last:pb-0">
                          <div className="flex justify-between items-start gap-2">
                            <span className="font-medium text-neutral-800 text-[13px]">
                              <span className="text-neutral-400 font-mono text-[10px] mr-1.5">{String((i + 1) * 10).padStart(3, '0')}</span>
                              {op.stepName}
                            </span>
                            <span className="text-red-600 font-mono text-xs font-medium shrink-0">{op.time}</span>
                          </div>
                          <span className="text-[11px] text-neutral-500">{op.tool}</span>
                          {op.spindleSpeedRpm !== undefined && (
                            <span className="text-[11px] text-neutral-400">
                              n = {op.spindleSpeedRpm} 1/min · vc = {op.vc} m/min · f = {op.feed} {op.feedUnit} · vf = {op.feedRateMmPerMin} mm/min
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="mt-3 pt-3 border-t border-neutral-200 flex justify-between items-center gap-4">
                      <span className="text-[11px] text-neutral-500 font-semibold uppercase tracking-wider shrink-0">{t.total}</span>
                      <span className="text-sm font-mono text-red-600 font-semibold text-right">{currentManufacturingAnalysis.totalEstimatedMachiningTime}</span>
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-3">
                {Array.isArray(currentRecommendations) && currentRecommendations.map((rec, recIdx) => (
                  <div key={recIdx} className="border border-neutral-200 rounded-lg p-4 relative">
                    <div className="text-[10px] font-semibold text-red-600 uppercase tracking-wider mb-1">
                      {t.recommendation} {recIdx + 1}
                    </div>
                    <h2 className="text-base font-semibold text-neutral-900 mb-1.5">{rec.product}</h2>
                    <p className="text-xs text-neutral-500 leading-relaxed mb-3">{rec.description}</p>
                    {rec.technicalData && (
                      <div className="bg-neutral-50 border border-neutral-200 rounded p-3 text-xs text-neutral-600 whitespace-pre-wrap font-mono leading-relaxed">
                        {rec.technicalData}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="h-full flex flex-col justify-center max-w-md mx-auto"
            >
              <h2 className="text-2xl font-bold tracking-tight text-neutral-900 mb-2">
                {t.heroTitle1}<br />
                <span className="text-red-600">{t.heroTitle2}</span>
              </h2>
              <p className="text-neutral-500 text-sm leading-relaxed mb-8">
                {t.heroText}
              </p>

              <div className="space-y-3 mb-8">
                {t.features.map((f, i) => {
                  const Icon = FEATURE_ICONS[i];
                  return (
                  <div key={i} className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded bg-red-50 border border-red-100 flex items-center justify-center shrink-0">
                      <Icon size={15} className="text-red-600" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-neutral-800">{f.title}</p>
                      <p className="text-xs text-neutral-500">{f.text}</p>
                    </div>
                  </div>
                  );
                })}
              </div>

              <div>
                <p className="text-[11px] text-neutral-400 font-semibold uppercase tracking-wider mb-2">{t.examplesLabel}</p>
                <div className="space-y-2">
                  {t.examples.map((ex, i) => (
                    <button
                      key={i}
                      onClick={() => submitText(ex)}
                      disabled={isLoading}
                      className="w-full text-left text-xs text-neutral-600 bg-white hover:bg-neutral-50 border border-neutral-200 hover:border-red-300 rounded-lg px-3.5 py-2.5 transition-colors flex items-center gap-2 group"
                    >
                      <ChevronRight size={12} className="text-neutral-300 group-hover:text-red-600 transition-colors shrink-0" />
                      {ex}
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {showAssessment && (
          <AssessmentForm
            onClose={() => setShowAssessment(false)}
            onSubmit={handleAssessmentSubmit}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
