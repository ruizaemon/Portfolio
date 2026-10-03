import { inject, type InjectionKey } from 'vue';
import type { createToolI18n } from '../../toolI18n';
import type { NodeId } from '../engine/model';
import { TIMEOUT_MS } from '../engine/simulate';

export type SimI18n = ReturnType<typeof createToolI18n> & {
  ms: (value: number) => string;
  pct: (ratio: number) => string;
};

export const SIM_I18N: InjectionKey<SimI18n> = Symbol('capacity-sim-i18n');

export function withFormatters(base: ReturnType<typeof createToolI18n>): SimI18n {
  const { t, num } = base;
  return {
    ...base,
    ms: (value) => {
      if (value >= TIMEOUT_MS) return t('m.timeout');
      if (value < 10) return `${num(Math.round(value * 10) / 10)} ms`;
      if (value < 1000) return `${num(Math.round(value))} ms`;
      return `${num(Math.round(value / 100) / 10)} s`;
    },
    pct: (ratio) => `${num(Math.round(ratio * 1000) / 10)}%`,
  };
}

export function useSimI18n(): SimI18n {
  const i18n = inject(SIM_I18N);
  if (!i18n) throw new Error('capacity-sim i18n not provided');
  return i18n;
}

/** Translation group for a node's capacity formulas. */
export function formulaGroup(id: NodeId): 'app' | 'lb' | 'cache' | 'db' | null {
  if (id === 'dbPrimary' || id === 'dbReplica') return 'db';
  if (id === 'cdn') return null;
  return id;
}

/** Utilization band, used for colors. */
export function utilLevel(u: number): 'ok' | 'warn' | 'bad' {
  if (u < 0.6) return 'ok';
  if (u < 0.85) return 'warn';
  return 'bad';
}
