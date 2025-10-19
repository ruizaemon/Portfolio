export interface Language {
  code: string;
  name: string;
  flag: string;
  nativeName: string;
}

export const languages: Language[] = [
  {
    code: 'en',
    name: 'English',
    flag: '🇺🇸',
    nativeName: 'English'
  },
  {
    code: 'ja',
    name: 'Japanese',
    flag: '🇯🇵',
    nativeName: '日本語'
  }
];

export function getLanguageByCode(code: string): Language | undefined {
  return languages.find(lang => lang.code === code);
}

export function getCurrentLanguageDisplay(currentLocale: string): string {
  const language = getLanguageByCode(currentLocale);
  if (!language) {
    // Fallback to first language if current locale not found
    return `${languages[0].flag} ${languages[0].nativeName}`;
  }
  return `${language.flag} ${language.nativeName}`;
}
