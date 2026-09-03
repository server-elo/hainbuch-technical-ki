import { API_BASE, apiHeaders } from '../config';

export interface HistoryItem {
  id: string;
  title: string;
  country_code: string;
  ui_lang: string;
  message_count: number;
  created_at: string;
  updated_at: string;
}

export interface HistoryMessage {
  role: string;
  content: string;
  images_meta: string;
  analysis: string;
  model: string;
  duration_ms: number;
  created_at: string;
}

async function req(path: string, init?: RequestInit) {
  const r = await fetch(`${API_BASE}${path}`, {
    ...(init || {}),
    headers: { ...apiHeaders(), ...((init && init.headers) || {}) },
  });
  if (!r.ok) {
    const err: Error & { status?: number } = new Error(`HTTP ${r.status}`);
    err.status = r.status;
    throw err;
  }
  return r.json();
}

/** Register / login with email (stub phase). Returns { token, user }. */
export async function syncProfile(body: {
  email: string; displayName?: string; country?: string; uiLang?: string;
  consentTerms?: boolean; consentMarketing?: boolean; loginOnly?: boolean;
}): Promise<{ token: string; user: { id: string; email: string; displayName: string; country: string; uiLang: string } }> {
  return req('/api/auth/sync', { method: 'POST', body: JSON.stringify(body) });
}

export async function listHist(): Promise<HistoryItem[]> {
  const j = await req('/api/history');
  return Array.isArray(j.conversations) ? j.conversations : [];
}

export async function createHist(title: string): Promise<HistoryItem | null> {
  const j = await req('/api/history', { method: 'POST', body: JSON.stringify({ title }) });
  return j.conversation || null;
}

export async function getHist(id: string): Promise<(HistoryItem & { messages: HistoryMessage[] }) | null> {
  try {
    const j = await req(`/api/history/${encodeURIComponent(id)}`);
    return j.conversation || null;
  } catch {
    return null;
  }
}

export async function renameHist(id: string, title: string): Promise<boolean> {
  try {
    await req(`/api/history/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ title }) });
    return true;
  } catch {
    return false;
  }
}

export async function deleteHist(id: string): Promise<boolean> {
  try {
    await req(`/api/history/${encodeURIComponent(id)}`, { method: 'DELETE' });
    return true;
  } catch {
    return false;
  }
}
