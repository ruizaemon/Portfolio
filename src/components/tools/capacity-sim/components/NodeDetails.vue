<script setup lang="ts">
import { computed } from 'vue';
import type { NodeId, SimResult } from '../engine/model';
import { formulaGroup, useSimI18n, utilLevel } from './context';

const props = defineProps<{ result: SimResult; nodeId: NodeId }>();
const { t, num, ms, pct } = useSimI18n();

const node = computed(() => props.result.nodes[props.nodeId]);
const unit = computed(() => (node.value ? t(`units.${node.value.unit}`) : ''));

const limits = computed(() => {
  const n = node.value;
  const group = formulaGroup(props.nodeId);
  if (!n || !group) return [];
  return n.limits.map((l) => ({
    resource: l.resource,
    name: t(`res.${l.resource}`),
    formula: t(`formulas.${group}.${l.formula ?? l.resource}`, l.inputs),
    capacity: l.capacity,
    utilization: l.utilization,
    limiting: l.resource === n.limitingResource,
  }));
});
</script>

<template>
  <div v-if="node" class="details">
    <header class="details-header">
      <h3 class="details-title">{{ t('details.title') }} · {{ t(`nodes.${nodeId}`) }}</h3>
      <span v-if="node.instances > 1" class="instances">{{ t('details.instances', { n: node.instances }) }}</span>
    </header>

    <p v-if="nodeId === 'cdn'" class="explain">{{ t('details.cdn') }}</p>

    <template v-else>
      <dl class="stats">
        <div>
          <dt>{{ t('details.load') }}</dt>
          <dd>{{ num(node.offered) }} {{ unit }}</dd>
        </div>
        <div>
          <dt>{{ t('details.capacity') }}</dt>
          <dd>{{ num(node.capacity) }} {{ unit }}</dd>
        </div>
        <div>
          <dt>{{ t('details.utilization') }}</dt>
          <dd :class="utilLevel(node.utilization)">{{ pct(node.utilization) }}</dd>
        </div>
        <div>
          <dt>{{ t('details.latency') }}</dt>
          <dd>{{ ms(node.avgLatencyMs) }} / {{ ms(node.p99LatencyMs) }}</dd>
        </div>
      </dl>
      <p v-if="node.instances > 1" class="per-instance">{{ t('details.perInstance') }}</p>

      <h4 class="limits-title">{{ t('details.limits') }}</h4>
      <ul class="limits">
        <li v-for="l in limits" :key="l.resource" :class="{ limiting: l.limiting }">
          <div class="limit-head">
            <span class="limit-name">{{ l.name }}</span>
            <span v-if="l.limiting" class="limit-pill">{{ t('details.limiting') }}</span>
            <span class="limit-util" :class="utilLevel(l.utilization)">{{ pct(l.utilization) }}</span>
          </div>
          <code class="formula">{{ l.formula }} = {{ num(l.capacity) }} {{ unit }}</code>
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.details-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-bottom: 0.75rem;
}

.details-title {
  font-size: 1rem;
  font-weight: 600;
  margin: 0;
}

.instances,
.per-instance {
  font-size: 0.75rem;
  color: var(--color-text-muted);
}

.per-instance {
  margin: 0.375rem 0 0;
}

.explain {
  margin: 0;
  font-size: 0.875rem;
  line-height: 1.6;
  color: var(--color-text-muted);
}

.stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 0.5rem 1rem;
  margin: 0;
}

.stats dt {
  font-size: 0.75rem;
  color: var(--color-text-muted);
}

.stats dd {
  margin: 0.125rem 0 0;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.limits-title {
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  margin: 1rem 0 0.5rem;
}

.limits {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.limits li {
  padding: 0.5rem 0.75rem;
  border-radius: 8px;
  border: 1px solid var(--panel-border);
}

.limits li.limiting {
  border-color: color-mix(in srgb, var(--color-primary) 50%, transparent);
}

.limit-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.8125rem;
  font-weight: 600;
}

.limit-pill {
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: 0.0625rem 0.4375rem;
  border-radius: 999px;
  color: var(--color-primary);
  border: 1px solid var(--color-primary);
}

.limit-util {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}

.formula {
  display: block;
  margin-top: 0.25rem;
  font-family: inherit;
  font-size: 0.75rem;
  color: var(--color-text-muted);
  line-height: 1.5;
  overflow-wrap: anywhere;
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
</style>
