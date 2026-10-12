<script setup lang="ts">
import { computed } from 'vue';
import type { DistConfig, DistResult } from '../engine/model';
import { parseNodeId } from '../engine/model';
import { useDistI18n, utilLevel } from './context';

const props = defineProps<{ config: DistConfig; result: DistResult }>();
const { t, num, ms, pct } = useDistI18n();

const rps = computed(() => props.config.stack.traffic.rps);
const load = computed(() => rps.value / props.result.maxRps);

const capacityNote = computed(() => {
  if (load.value <= 1) return t('m.headroom', { x: Math.floor((1 / load.value) * 10) / 10 });
  return t('m.overCapacity', { x: Math.round((load.value - 1) * 100) });
});

const bottleneck = computed(() => {
  const b = props.result.bottleneck;
  if (!b) return t('m.none');
  const { kind, region } = parseNodeId(b.node);
  const where = props.result.live.length > 1 ? ` · ${t('region', { n: region + 1 })}` : '';
  return `${t(`nodes.${kind}`)}${where} · ${t(`res.${b.resource}`)}`;
});

/** Whether the current traffic would still fit if one more region went down. */
const regionLoss = computed(() => {
  const max = props.result.maxRpsAfterRegionLoss;
  if (max === null) return { text: t('m.regionLossNone'), level: 'muted' };
  const over = rps.value / max;
  if (over <= 1) return { text: t('m.regionLossOk', { max: Math.floor(max) }), level: 'ok' };
  return {
    text: t('m.regionLossBad', { max: Math.floor(max), over: Math.round((over - 1) * 100) }),
    level: 'bad',
  };
});

const warnings = computed(() =>
  props.result.warnings.map((w) => {
    const vars: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(w)) {
      if (k === 'code') continue;
      vars[k] = v as number;
    }
    if (w.code === 'failover') {
      vars.from = w.from + 1;
      vars.to = w.to + 1;
    } else if (w.code === 'hotShard') {
      vars.share = pct(w.share);
      vars.even = pct(w.even);
    } else if (w.code === 'retries') {
      vars.retries = Math.round(w.retries);
      vars.extra = Math.round(w.extra * 100);
    } else if (w.code === 'shedding') {
      vars.shed = Math.round(w.shed);
    }
    return t(`warnings.${w.code}`, vars);
  }),
);
</script>

<template>
  <div>
    <dl class="metrics">
      <div class="metric">
        <dt>{{ t('m.traffic') }}</dt>
        <dd>{{ num(rps) }} <small>req/s</small></dd>
        <p v-if="result.retryRps > 0.5" class="note">{{ t('m.attempts', { n: Math.round(result.attemptsRps) }) }}</p>
      </div>
      <div class="metric">
        <dt>{{ t('m.maxRps') }}</dt>
        <dd :class="utilLevel(load)">{{ num(Math.floor(result.maxRps)) }} <small>req/s</small></dd>
        <p class="note">{{ capacityNote }}</p>
      </div>
      <div class="metric">
        <dt>{{ t('m.bottleneck') }}</dt>
        <dd class="text">{{ bottleneck }}</dd>
        <p class="note">{{ t('m.bottleneckHint') }}</p>
      </div>
      <div class="metric">
        <dt>{{ t('m.regionLoss') }}</dt>
        <dd class="text" :class="regionLoss.level">{{ regionLoss.text }}</dd>
        <p class="note">{{ t('m.regionLossHint') }}</p>
      </div>
      <div class="metric">
        <dt>{{ t('m.latency') }}</dt>
        <dd>{{ ms(result.avgLatencyMs) }} <span class="sep">/</span> {{ ms(result.p99LatencyMs) }}</dd>
      </div>
      <div class="metric">
        <dt>{{ t('m.errorRate') }}</dt>
        <dd :class="result.errorRate > 0.0005 ? 'bad' : 'ok'">{{ pct(result.errorRate) }}</dd>
        <p class="note">
          {{ t('m.served', { rps: Math.round(result.servedRps) }) }}
          <template v-if="result.shedRps > 0.5"> · {{ t('m.shed', { rps: Math.round(result.shedRps) }) }}</template>
        </p>
      </div>
    </dl>

    <table v-if="result.regions.length > 1" class="regions">
      <thead>
        <tr>
          <th>{{ t('regionsTitle') }}</th>
          <th>{{ t('m.traffic') }}</th>
          <th>{{ t('m.latencyShort') }}</th>
          <th>{{ t('m.errorRate') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in result.regions" :key="r.index" :class="{ down: !r.live }">
          <td>
            {{ t('region', { n: r.index + 1 }) }}
            <span v-if="r.home" class="tag">{{ t('home') }}</span>
            <span v-else-if="!r.live" class="tag bad">{{ t('down') }}</span>
          </td>
          <template v-if="r.live">
            <td>{{ num(Math.round(r.rps)) }} <small>req/s</small></td>
            <td>{{ ms(r.avgLatencyMs) }} <span class="sep">/</span> {{ ms(r.p99LatencyMs) }}</td>
            <td :class="r.errorRate > 0.0005 ? 'bad' : 'ok'">{{ pct(r.errorRate) }}</td>
          </template>
          <td v-else colspan="3" class="muted">{{ t('rerouted') }}</td>
        </tr>
      </tbody>
    </table>

    <ul v-if="warnings.length" class="warnings">
      <li v-for="w in warnings" :key="w">{{ w }}</li>
    </ul>
  </div>
</template>

<style scoped>
.metrics {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 0.75rem;
  margin: 0;
}

.metric {
  padding: 0.75rem;
  border-radius: 8px;
  border: 1px solid var(--panel-border);
  background-color: var(--panel-bg);
  min-width: 0;
}

dt {
  font-size: 0.75rem;
  color: var(--color-text-muted);
  margin-bottom: 0.25rem;
}

dd {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

dd.text {
  font-size: 0.9375rem;
  line-height: 1.4;
}

dd small,
td small {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--color-text-muted);
}

.sep {
  color: var(--color-text-muted);
  font-weight: 400;
}

.ok {
  color: var(--util-ok);
}

.warn {
  color: var(--util-warn);
}

.bad {
  color: var(--util-bad);
}

.muted {
  color: var(--color-text-muted);
}

.note {
  margin: 0.25rem 0 0;
  font-size: 0.75rem;
  color: var(--color-text-muted);
  line-height: 1.4;
}

.regions {
  width: 100%;
  margin-top: 0.75rem;
  border-collapse: collapse;
  font-size: 0.8125rem;
  font-variant-numeric: tabular-nums;
}

.regions th {
  text-align: left;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  padding: 0.25rem 0.5rem;
  border-bottom: 1px solid var(--panel-border);
}

.regions td {
  padding: 0.375rem 0.5rem;
  border-bottom: 1px solid color-mix(in srgb, var(--panel-border) 60%, transparent);
}

.regions tr.down td {
  color: var(--color-text-muted);
}

.tag {
  margin-left: 0.25rem;
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-primary);
}

.tag.bad {
  color: var(--util-bad);
}

.warnings {
  margin: 0.75rem 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.warnings li {
  font-size: 0.8125rem;
  line-height: 1.5;
  padding: 0.5rem 0.75rem;
  border-radius: 8px;
  border-left: 3px solid var(--util-warn);
  background-color: color-mix(in srgb, var(--util-warn) 10%, transparent);
}
</style>
