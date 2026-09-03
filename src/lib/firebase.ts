/** Firebase Auth (Google sign-in) — optional, null-safe when unconfigured.
 *  Config comes from build-time VITE_FIREBASE_* vars (public browser keys).
 *  Until the console enables a provider AND the backend sets
 *  FIREBASE_PROJECT_ID, this module is inert and the stub flow is used. */
import { API_BASE } from '../config';

const apiKey = import.meta.env.VITE_FIREBASE_API_KEY || '';
const authDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '';
const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID || '';

export const firebaseConfigured: boolean = !!(apiKey && authDomain && projectId);

type FirebaseApp = import('firebase/app').FirebaseApp;
type Auth = import('firebase/auth').Auth;

let app: FirebaseApp | null = null;
let auth: Auth | null = null;

async function getAuth(): Promise<Auth | null> {
  if (!firebaseConfigured) return null;
  if (auth) return auth;
  const { initializeApp, getApps } = await import('firebase/app');
  const { getAuth: getFirebaseAuth } = await import('firebase/auth');
  app = getApps()[0] || initializeApp({ apiKey, authDomain, projectId });
  auth = getFirebaseAuth(app);
  return auth;
}

/** Google popup sign-in → { idToken, email, displayName }. Throws on cancel/failure. */
export async function signInWithGoogle(): Promise<{ idToken: string; email: string; displayName: string }> {
  const a = await getAuth();
  if (!a) throw new Error('firebase-unconfigured');
  const { GoogleAuthProvider, signInWithPopup } = await import('firebase/auth');
  const cred = await signInWithPopup(a, new GoogleAuthProvider());
  const idToken = await cred.user.getIdToken();
  return {
    idToken,
    email: cred.user.email || '',
    displayName: cred.user.displayName || '',
  };
}

/** Register/login on our backend with a verified Firebase ID token + consents.
 *  The ID token is used ONCE here (it expires after 1h). The server links
 *  the verified Google identity to the account and returns our own opaque
 *  session token, which becomes the stored credential (same as stub flow). */
export async function syncWithFirebase(body: {
  idToken: string; displayName?: string; country?: string; uiLang?: string;
  consentTerms: boolean; consentMarketing: boolean;
}): Promise<{ token: string; user: { id: string; email: string; displayName: string; country: string; uiLang: string } }> {
  const r = await fetch(`${API_BASE}/api/auth/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${body.idToken}` },
    body: JSON.stringify({
      displayName: body.displayName, country: body.country, uiLang: body.uiLang,
      consentTerms: body.consentTerms, consentMarketing: body.consentMarketing,
    }),
  });
  if (!r.ok) {
    const err: Error & { status?: number } = new Error(`HTTP ${r.status}`);
    err.status = r.status;
    throw err;
  }
  const j = await r.json();
  // Server verified the Google identity, linked the account and issued its
  // own session token — store that (long-lived, revocable), not the ID token.
  return { token: j.token, user: j.user };
}
