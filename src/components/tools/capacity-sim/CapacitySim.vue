<script setup lang="ts">
import { computed, ref } from 'vue';
import { t as translate } from '@/utils/i18n';

const props = defineProps<{ locale: string }>();
const t = (key: string) => translate(props.locale, `tools.capacitySim.${key}`);

// Traffic slider works on a log scale: 0 → 1 rps, 6 → 1,000,000 rps
const rpsExponent = ref(3);
const rps = computed(() => Math.round(10 ** rpsExponent.value));
const numberFormat = computed(() => new Intl.NumberFormat(props.locale));
</script>

<template>
  <div class="sim">
    <aside class="panel controls">
      <h2 class="panel-title">{{ t('controls') }}</h2>

      <section class="control-group">
        <h3 class="group-title">{{ t('traffic') }}</h3>
        <label class="field">
          <span class="field-label">
            {{ t('requestsPerSec') }}
            <output class="field-value">{{ numberFormat.format(rps) }}</output>
          </span>
          <input v-model.number="rpsExponent" type="range" min="0" max="6" step="0.01" />
        </label>
      </section>

      <section class="control-group">
        <h3 class="group-title">{{ t('architecture') }}</h3>
        <p class="placeholder-text">—</p>
      </section>
    </aside>

    <div class="main-column">
      <div class="panel diagram">
        <p class="placeholder-text">{{ t('underConstruction') }}</p>
      </div>

      <div class="panel metrics">
        <h2 class="panel-title">{{ t('metrics') }}</h2>
        <dl class="metric-grid">
          <div class="metric">
            <dt>{{ t('maxRps') }}</dt>
            <dd>—</dd>
          </div>
          <div class="metric">
            <dt>{{ t('bottleneck') }}</dt>
            <dd>—</dd>
          </div>
          <div class="metric">
            <dt>{{ t('latency') }}</dt>
            <dd>—</dd>
          </div>
          <div class="metric">
            <dt>{{ t('errorRate') }}</dt>
            <dd>—</dd>
          </div>
        </dl>
      </div>
    </div>
  </div>
</template>

<style scoped>
.sim {
  --panel-border: rgba(255, 255, 255, 0.12);
  --panel-bg: rgba(255, 255, 255, 0.02);
  display: grid;
  grid-template-columns: 1fr;
  gap: 1rem;
}

:global([data-theme="light"]) .sim {
  --panel-border: rgba(0, 0, 0, 0.2);
  --panel-bg: rgba(0, 0, 0, 0.02);
}

@media (min-width: 900px) {
  .sim {
    grid-template-columns: minmax(260px, 320px) 1fr;
  }
}

.panel {
  border: 1px solid var(--panel-border);
  border-radius: 12px;
  background-color: var(--panel-bg);
  padding: 1rem 1.25rem;
}

.panel-title {
  font-size: 1rem;
  font-weight: 600;
  margin: 0 0 1rem;
}

.main-column {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-width: 0;
}

.control-group + .control-group {
  margin-top: 1.25rem;
  padding-top: 1rem;
  border-top: 1px solid var(--panel-border);
}

.group-title {
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  margin: 0 0 0.75rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.field-label {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: 0.875rem;
}

.field-value {
  color: var(--color-primary);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.field input[type="range"] {
  width: 100%;
  accent-color: var(--color-primary);
}

.diagram {
  min-height: 360px;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
}

.placeholder-text {
  color: var(--color-text-muted);
  font-size: 0.875rem;
  margin: 0;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 0.75rem;
  margin: 0;
}

.metric {
  padding: 0.75rem;
  border-radius: 8px;
  background-color: var(--panel-bg);
  border: 1px solid var(--panel-border);
}

.metric dt {
  font-size: 0.75rem;
  color: var(--color-text-muted);
  margin-bottom: 0.25rem;
}

.metric dd {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
</style>
