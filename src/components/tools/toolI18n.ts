import { t as translate } from '@/utils/i18n';

export type Vars = Record<string, string | number>;

/**
 * Translation and number formatting for a tool's Vue components.
 * Keys are relative to `prefix`; `{name}` placeholders are filled from `vars`,
 * with numbers formatted for the locale.
 */
export function createToolI18n(locale: string, prefix: string) {
  const plain = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const compact = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 });

  /** Locale-formatted number; large values use compact notation (12K, 1.2万). */
  const num = (n: number): string => {
    if (!Number.isFinite(n)) return '∞';
    return Math.abs(n) >= 10_000 ? compact.format(n) : plain.format(n);
  };

  const t = (key: string, vars?: Vars): string => {
    const text = String(translate(locale, `${prefix}.${key}`));
    if (!vars) return text;
    return text.replace(/\{(\w+)\}/g, (match, name: string) => {
      const value = vars[name];
      if (value === undefined) return match;
      return typeof value === 'number' ? num(value) : value;
    });
  };

  return { t, num };
}
