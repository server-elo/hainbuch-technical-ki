import { useState } from 'react';
import type { ChatMessage } from '../types';
import type { Profile } from '../lib/profile';
import { listHist, getHist, renameHist, deleteHist, type HistoryItem } from '../lib/historyApi';

export function useHistoryManager({
  profile,
  conversationId,
  setConversationId,
  setMessages,
  stopGeneration,
  resetChat,
}: {
  profile: Profile;
  conversationId: string | null;
  setConversationId: (id: string | null) => void;
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  stopGeneration: () => void;
  resetChat: () => void;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const [histItems, setHistItems] = useState<HistoryItem[]>([]);
  const [histLoading, setHistLoading] = useState(false);

  const refreshHistList = async () => {
    if (!profile.email && !profile.token) return;
    setHistLoading(true);
    try {
      setHistItems(await listHist());
    } catch {
      // offline — sidebar shows empty state
    } finally {
      setHistLoading(false);
    }
  };

  const openHistoryPanel = () => {
    setShowHistory(true);
    void refreshHistList();
  };

  const openConversation = async (id: string) => {
    const c = await getHist(id);
    if (!c) return;
    const msgs: ChatMessage[] = [{ role: 'model', parts: [{ text: '' }] }];
    for (const m of c.messages || []) {
      if (m.role === 'user') msgs.push({ role: 'user', parts: [{ text: m.content }] });
      else msgs.push({ role: 'model', parts: [{ text: m.content }] });
    }
    stopGeneration();
    setConversationId(id);
    setMessages(msgs.length > 1 ? msgs : [{ role: 'model', parts: [{ text: '' }] }]);
    setShowHistory(false);
  };

  const handleRenameHist = (id: string, title: string) => {
    void renameHist(id, title).then(ok => {
      if (ok) void refreshHistList();
    });
  };

  const handleDeleteHist = (id: string) => {
    void deleteHist(id).then(ok => {
      if (ok) {
        if (conversationId === id) resetChat();
        void refreshHistList();
      }
    });
  };

  return {
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
  };
}

export default useHistoryManager;
