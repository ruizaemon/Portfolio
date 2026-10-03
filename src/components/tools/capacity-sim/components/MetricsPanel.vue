<script setup lang="ts">
import { computed } from 'vue';
import type { SimConfig, SimResult } from '../engine/model';
import { useSimI18n, utilLevel } from './context';

const props = defineProps<{ config: SimConfig; result: SimResult }>();
const { t, num, ms, pct } = useSimI18n();

const rps = computed(() => props.config.traffic.rps);
const load = computed(() => rps.value / props.result.maxRps);

const capacityNote = computed(() => {
  if (load.value <= 1) return t('m.headroom', { x: Math.floor((1 / load.value) * 10) / 10 });
  return t('m.overCapacity', { x: Math.round((load.value - 1) * 100) });
});

const bottleneck = computed(() => {
  const b = props.result.bottleneck;
  if (!b) return t('m.none');
  return `${t(`nodes.${b.node}`)} · ${t(`res.${b.resource}`)}`;
});

const warnings = computed(() =>
  props.result.warnings.map(({ code, ...vars }) => t(`warnings.${code}`, vars)),
);
</script>

<template>
  <div>
    <dl class="metrics">
      <div class="metric">
        <dt>{{ t('m.traffic') }}</dt>
        <dd>{{ num(rps) }} <small>req/s</small></dd>
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
        <dt>{{ t('m.latency') }}</dt>
        <dd>{{ ms(result.avgLatencyMs) }} <span class="sep">/</span> {{ ms(result.p99LatencyMs) }}</dd>
      </div>
      <div class="metric">
        <dt>{{ t('m.errorRate') }}</dt>
        <dd :class="result.errorRate > 0.0005 ? 'bad' : 'ok'">{{ pct(result.errorRate) }}</dd>
        <p class="note">{{ t('m.served', { rps: Math.round(result.servedRps) }) }}</p>
      </div>
    </dl>

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

dd small {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--color-text-muted);
}

.sep {
  color: var(--color-text-muted);
  font-weight: 400;
}

dd.ok {
  color: var(--util-ok);
}

dd.warn {
  color: var(--util-warn);
}

dd.bad {
  color: var(--util-bad);
}

.note {
  margin: 0.25rem 0 0;
  font-size: 0.75rem;
  color: var(--color-text-muted);
  line-height: 1.4;
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
