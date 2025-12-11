import en from '../i18n/en.json';
import ja from '../i18n/ja.json';

const translations = {
  en,
  ja,
} as const;

export type Locale = keyof typeof translations;

export function getTranslations(locale: string) {
  return translations[locale as Locale] || translations.en;
}

export function t(locale: string, key: string) {
  const translation = getTranslations(locale);
  const keys = key.split('.');
  let value: any = translation;
  
  for (const k of keys) {
    value = value?.[k]; // "?." optional chaining
  }
  
  return value || key;
}
