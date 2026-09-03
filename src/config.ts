/** API endpoint configuration.
 *  Local dev: same origin (empty base). Online (Firebase Hosting): the
 *  backend runs on the Mac behind a Cloudflare tunnel — base + key come
 *  from build-time env vars. */
export const API_BASE: string = import.meta.env.VITE_API_BASE || '';
export const APP_KEY: string = import.meta.env.VITE_APP_KEY || '';

export const apiHeaders = (): Record<string, string> => {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(APP_KEY ? { 'x-app-key': APP_KEY } : {}),
  };
  // Identity + language for history/experiments. Best-effort: never break chat.
  try {
    const raw = localStorage.getItem('hb-profile-v1');
    if (raw) {
      const p = JSON.parse(raw);
      if (p && typeof p.email === 'string' && p.email) h['x-user-email'] = p.email;
      if (p && typeof p.token === 'string' && p.token) h['Authorization'] = `Bearer ${p.token}`;
      if (p && typeof p.uiLangOverride === 'string' && p.uiLangOverride) h['x-ui-lang'] = p.uiLangOverride;
      else {
        const l = localStorage.getItem('ui-lang');
        if (l) h['x-ui-lang'] = l;
      }
    } else {
      const l = localStorage.getItem('ui-lang');
      if (l) h['x-ui-lang'] = l;
    }
  } catch { /* storage unavailable */ }
  return h;
};
