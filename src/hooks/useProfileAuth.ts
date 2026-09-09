import { useState, useRef, useEffect } from 'react';
import { T, type UiLang } from '../i18n';
import { API_BASE } from '../config';
import { loadProfile, saveProfile, clearProfile, suggestedLangFor, type Profile } from '../lib/profile';

/** Country (via Cloudflare CF-IPCountry) → UI language */
export const COUNTRY_LANG: Record<string, UiLang> = {
  DE: 'de', AT: 'de', CH: 'de', LI: 'de', LU: 'de',
  CN: 'zh', TW: 'zh', HK: 'zh', MO: 'zh', SG: 'zh',
  ES: 'es', MX: 'es', AR: 'es', CO: 'es', CL: 'es', PE: 'es',
  FR: 'fr', MC: 'fr',
  IT: 'it', SM: 'it',
  TR: 'tr',
};

export function useProfileAuth(onResetChat?: () => void) {
  const [profile, setProfile] = useState<Profile>(() => loadProfile());
  const [uiLang, setUiLang] = useState<UiLang>(() => profile.uiLangOverride || 'de');
  const [geoCountry, setGeoCountry] = useState('');
  const [showAuth, setShowAuth] = useState(false);
  const [showCountry, setShowCountry] = useState(false);

  const t = T[uiLang];
  const profileRef = useRef(profile);
  useEffect(() => { profileRef.current = profile; }, [profile]);

  const isAuth = () => Boolean(profileRef.current.email || profileRef.current.token);

  // Follow IP country if user hasn't explicitly set a preference
  useEffect(() => {
    fetch(`${API_BASE}/api/status`)
      .then(r => r.json())
      .then(s => {
        const cc = typeof s.country === 'string' ? s.country : '';
        if (cc) setGeoCountry(cc);
        let override = '';
        try { override = loadProfile().uiLangOverride || ''; } catch { /* ignore */ }
        if (override || !cc) return;
        if (COUNTRY_LANG[cc]) setUiLang(COUNTRY_LANG[cc]);
        else setUiLang('en');
      })
      .catch(() => { /* keep stored/default */ });
  }, []);

  // Sync uiLang with localStorage for apiHeaders
  useEffect(() => {
    try { localStorage.setItem('ui-lang', uiLang); } catch { /* ignore */ }
  }, [uiLang]);

  const handleAuthSaved = (r: { email: string; displayName: string; country: string; token: string }) => {
    const next: Profile = {
      ...profile,
      email: r.email,
      displayName: r.displayName,
      country: r.country || profile.country || geoCountry,
      token: r.token,
    };
    profileRef.current = next;
    if (!next.uiLangOverride) {
      const s = (next.country && suggestedLangFor(next.country))
        || (geoCountry && COUNTRY_LANG[geoCountry]) || null;
      if (s) setUiLang(s);
    }
    setProfile(next);
    saveProfile(next);
    setShowAuth(false);
  };

  const handleLogout = () => {
    clearProfile();
    setProfile(loadProfile());
    if (onResetChat) onResetChat();
  };

  const handleCountryPick = (country: string, lang: UiLang) => {
    setUiLang(lang);
    const next: Profile = { ...profile, country, uiLangOverride: lang };
    setProfile(next);
    saveProfile(next);
  };

  return {
    profile,
    setProfile,
    uiLang,
    setUiLang,
    geoCountry,
    t,
    showAuth,
    setShowAuth,
    showCountry,
    setShowCountry,
    isAuth,
    handleAuthSaved,
    handleLogout,
    handleCountryPick,
  };
}

export default useProfileAuth;
