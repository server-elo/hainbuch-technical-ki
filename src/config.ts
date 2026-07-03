/** API endpoint configuration.
 *  Local dev: same origin (empty base). Online (Firebase Hosting): the
 *  backend runs on the Mac behind a Cloudflare tunnel — base + key come
 *  from build-time env vars. */
export const API_BASE: string = import.meta.env.VITE_API_BASE || '';
export const APP_KEY: string = import.meta.env.VITE_APP_KEY || '';

export const apiHeaders = (): Record<string, string> => ({
  'Content-Type': 'application/json',
  ...(APP_KEY ? { 'x-app-key': APP_KEY } : {}),
});
