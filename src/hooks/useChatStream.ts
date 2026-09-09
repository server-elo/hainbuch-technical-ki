import { useState, useRef, useEffect } from 'react';
import type { ChatMessage, PipelineStatus } from '../types';
import { T, type UiLang } from '../i18n';
import { API_BASE, apiHeaders } from '../config';
import type { MachineProfile } from '../components/MachineSelector';
import type { Profile } from '../lib/profile';

/** Pipeline stages the i18n stage list covers (same order as t.stages). */
export const STAGE_INDEX: Record<string, number> = {
  'retrieval-material': 0,
  material: 1,
  'retrieval-catalog': 2,
  plan: 3,
  calc: 4,
};

export function stageLabelFor(stage: string, t: (typeof T)[keyof typeof T]): string {
  const idx = STAGE_INDEX[stage];
  return idx !== undefined ? t.stages[idx] : t.analyzing;
}

export interface UseChatStreamOptions {
  selectedMachine: MachineProfile;
  catalogMode: boolean;
  profile: Profile;
  uiLang: UiLang;
  t: (typeof T)[keyof typeof T];
  conversationId: string | null;
  setConversationId: (id: string | null) => void;
}

export function useChatStream({
  selectedMachine,
  catalogMode,
  profile,
  uiLang,
  t,
  conversationId,
  setConversationId,
}: UseChatStreamOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([{
    role: 'model',
    parts: [{ text: '' }], // index 0 is always rendered from t.welcome
  }]);
  const [isLoading, setIsLoading] = useState(false);
  const [pipeline, setPipeline] = useState<PipelineStatus | null>(null);
  const [showProgress, setShowProgress] = useState(false);
  const [queuedMessages, setQueuedMessages] = useState<{ text: string; file: File | null }[]>([]);

  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesRef = useRef(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  const lastRequestRef = useRef<ChatMessage[] | null>(null);

  const stopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsLoading(false);
    setPipeline(null);
    setShowProgress(false);
  };

  const sendChat = async (newMessages: ChatMessage[], machineOverride?: MachineProfile) => {
    setIsLoading(true);
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setPipeline({ stage: 'intent', label: '', infos: [], log: [], startedAt: Date.now() });

    try {
      const apiMessages = newMessages
        .filter((msg, idx) => !(idx === 0 && msg.role === 'model'))
        .map(({ role, parts }) => ({ role, parts }));

      const response = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: apiHeaders(),
        body: JSON.stringify({
          messages: apiMessages,
          machine: machineOverride || selectedMachine,
          ...(catalogMode ? {} : { mode: 'raw' }),
          conversationId: conversationId || undefined,
          email: profile.email || undefined,
          country: profile.country || undefined,
          uiLang,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const retryAfter = Number(response.headers.get('Retry-After') || 0);
        const err: any = new Error(`HTTP ${response.status}`);
        err.status = response.status;
        err.retryAfterSec = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined;
        throw err;
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
            const label = uiLang === 'de' ? ev.label : stageLabelFor(ev.stage, t);
            setPipeline(p => p ? { ...p, stage: ev.stage, label, log: p.log[p.log.length - 1] === label ? p.log : [...p.log, label] } : p);
          } else if (ev.type === 'info') {
            if (uiLang === 'de') {
              setPipeline(p => p ? { ...p, infos: [...p.infos, ev.label], log: [...p.log, ev.label] } : p);
            }
          } else if (ev.type === 'result') {
            result = ev.data;
          } else if (ev.type === 'error') {
            errMsg = ev.error;
          }
        }
      }

      if (errMsg) throw new Error(errMsg);
      if (!result) throw new Error('NO_RESULT');
      if (result.conversationId) setConversationId(result.conversationId);

      const hasAnalysis =
        (result.manufacturingAnalysis && typeof result.manufacturingAnalysis === 'object') ||
        (Array.isArray(result.recommendations) && result.recommendations.length > 0) ||
        (Array.isArray(result.fitSolutions) && result.fitSolutions.length > 0);

      setMessages(prev => [...prev, {
        role: 'model',
        parts: [{ text: result.message }],
        ...(hasAnalysis ? {
          analysis: {
            manufacturingAnalysis: result.manufacturingAnalysis ?? null,
            recommendations: Array.isArray(result.recommendations) ? result.recommendations : null,
            fitSolutions: Array.isArray(result.fitSolutions) ? result.fitSolutions : null,
            costComparison: result.costComparison ?? null,
            clampingCheck: result.clampingCheck ?? null,
            ecosystem: Array.isArray(result.ecosystem) ? result.ecosystem : null,
            salesNudge: result.salesNudge ?? null,
          },
        } : {}),
      }]);
    } catch (error: any) {
      if (error?.name === 'AbortError' || controller.signal.aborted) {
        console.log('Chat generation cancelled by user.');
        return;
      }
      console.error('Chat API Error:', error);
      const kind = error?.status === 429 ? 'rate'
        : (error instanceof TypeError || error?.message === 'Failed to fetch') ? 'offline'
        : 'server';
      setMessages(prev => [...prev, {
        role: 'model',
        parts: [{ text: '' }],
        error: { kind, retryAfterSec: error?.retryAfterSec },
      }]);
    } finally {
      setIsLoading(false);
      setPipeline(null);
      setShowProgress(false);
      abortControllerRef.current = null;
    }
  };

  const retryLast = () => {
    if (isLoading || !lastRequestRef.current) return;
    setMessages(prev => {
      const last = prev[prev.length - 1];
      const next = last?.error ? prev.slice(0, -1) : prev;
      messagesRef.current = next;
      return next;
    });
    void sendChat(lastRequestRef.current);
  };

  const resetChat = () => {
    if (isLoading) stopGeneration();
    setQueuedMessages([]);
    setConversationId(null);
    setMessages([{ role: 'model', parts: [{ text: '' }] }]);
  };

  return {
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
    resetChat,
  };
}

export default useChatStream;
