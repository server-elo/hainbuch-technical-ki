import type { UiLang } from './i18n';

const LOCALE: Record<UiLang, string> = {
  de: 'de-DE',
  en: 'en-GB',
  zh: 'zh-CN',
  es: 'es-ES',
  fr: 'fr-FR',
  it: 'it-IT',
  tr: 'tr-TR',
};

/** Locale-correct number — German engineering docs need a decimal comma. */
export function num(value: number | null | undefined, lang: UiLang, maxDigits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat(LOCALE[lang] ?? 'de-DE', {
    maximumFractionDigits: maxDigits,
  }).format(value);
}

/** Money with the locale's own grouping and separator. */
export function eur(value: number | null | undefined, lang: UiLang): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat(LOCALE[lang] ?? 'de-DE', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 2,
  }).format(value);
}
