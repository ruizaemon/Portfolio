import { inject, type InjectionKey } from 'vue';
import type { createToolI18n } from '../../toolI18n';
import { SIM_I18N, type SimI18n } from '../../capacity-sim/components/context';
import type { NodeKind } from '../engine/model';
import { TIMEOUT_MS } from '../engine/simulate';

export { utilLevel } from '../../capacity-sim/components/context';
export type { SimI18n };

/**
 * Part 1's slider and group controls read their i18n through its injection
 * key, so this tool provides the same key with its own translation prefix.
 */
export const DIST_I18N: InjectionKey<SimI18n> = SIM_I18N;

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

export function useDistI18n(): SimI18n {
  const i18n = inject(DIST_I18N);
  if (!i18n) throw new Error('distributed-sim i18n not provided');
  return i18n;
}

/** Translation group for a node's capacity formulas. */
export function formulaGroup(kind: NodeKind): Exclude<NodeKind, 'cdn'> | null {
  return kind === 'cdn' ? null : kind;
}
