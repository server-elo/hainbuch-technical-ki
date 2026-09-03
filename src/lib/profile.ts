import type { UiLang } from '../i18n';

export interface Profile {
  email: string;
  displayName: string;
  country: string; // ISO-3166-1 alpha-2, e.g. 'DE'
  uiLangOverride: UiLang | ''; // '' = automatic (geo suggestion)
  token: string; // session token from /api/auth/sync (stub phase)
  consentMarketing: boolean;
}

const KEY = 'hb-profile-v1';

/** HAINBUCH markets: country → suggested UI language (user can always override). */
export const COUNTRIES: { code: string; name: string; lang: UiLang }[] = [
  { code: 'DE', name: 'Deutschland', lang: 'de' },
  { code: 'AT', name: 'Österreich', lang: 'de' },
  { code: 'CH', name: 'Schweiz / Suisse', lang: 'de' },
  { code: 'LI', name: 'Liechtenstein', lang: 'de' },
  { code: 'LU', name: 'Luxembourg', lang: 'de' },
  { code: 'FR', name: 'France', lang: 'fr' },
  { code: 'BE', name: 'België / Belgique', lang: 'fr' },
  { code: 'IT', name: 'Italia', lang: 'it' },
  { code: 'ES', name: 'España', lang: 'es' },
  { code: 'MX', name: 'México', lang: 'es' },
  { code: 'AR', name: 'Argentina', lang: 'es' },
  { code: 'CO', name: 'Colombia', lang: 'es' },
  { code: 'CL', name: 'Chile', lang: 'es' },
  { code: 'CN', name: '中国', lang: 'zh' },
  { code: 'TW', name: '台灣', lang: 'zh' },
  { code: 'HK', name: '香港', lang: 'zh' },
  { code: 'TR', name: 'Türkiye', lang: 'tr' },
  { code: 'US', name: 'United States', lang: 'en' },
  { code: 'GB', name: 'United Kingdom', lang: 'en' },
  { code: 'IE', name: 'Ireland', lang: 'en' },
  { code: 'CA', name: 'Canada', lang: 'en' },
  { code: 'AU', name: 'Australia', lang: 'en' },
  { code: 'IN', name: 'India', lang: 'en' },
  { code: 'NL', name: 'Nederland', lang: 'en' },
  { code: 'SE', name: 'Sverige', lang: 'en' },
  { code: 'PL', name: 'Polska', lang: 'en' },
  { code: 'CZ', name: 'Česko', lang: 'en' },
  { code: 'BR', name: 'Brasil', lang: 'en' },
  { code: 'PT', name: 'Portugal', lang: 'en' },
  { code: 'JP', name: '日本', lang: 'en' },
  { code: 'KR', name: '한국', lang: 'en' },
  { code: 'AE', name: 'UAE', lang: 'en' },
  { code: 'ZA', name: 'South Africa', lang: 'en' },
];

export const LANG_NAMES: Record<UiLang, string> = {
  de: 'Deutsch', en: 'English', zh: '中文', es: 'Español',
  fr: 'Français', it: 'Italiano', tr: 'Türkçe',
};

const EMPTY: Profile = {
  email: '', displayName: '', country: '', uiLangOverride: '', token: '', consentMarketing: false,
};

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY };
    const p = JSON.parse(raw);
    return {
      email: typeof p.email === 'string' ? p.email : '',
      displayName: typeof p.displayName === 'string' ? p.displayName : '',
      country: typeof p.country === 'string' ? p.country : '',
      uiLangOverride: typeof p.uiLangOverride === 'string' ? p.uiLangOverride : '',
      token: typeof p.token === 'string' ? p.token : '',
      consentMarketing: !!p.consentMarketing,
    };
  } catch {
    return { ...EMPTY };
  }
}

export function saveProfile(p: Profile) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
    if (p.uiLangOverride) localStorage.setItem('ui-lang', p.uiLangOverride);
  } catch { /* storage unavailable */ }
}

export function clearProfile() {
  try {
    localStorage.removeItem(KEY);
  } catch { /* ignore */ }
}

export function suggestedLangFor(countryCode: string): UiLang | null {
  const c = COUNTRIES.find((x) => x.code === countryCode);
  return c ? c.lang : null;
}
