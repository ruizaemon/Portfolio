<script setup lang="ts">
import { computed } from 'vue';
import type { ServerType, SimConfig } from '../engine/model';
import { workersThatFit } from '../engine/simulate';
import { PRESET_IDS, type PresetId } from '../engine/presets';
import SliderField from './SliderField.vue';
import { useSimI18n } from './context';

defineProps<{ activePreset: PresetId | null }>();
const emit = defineEmits<{ preset: [id: PresetId] }>();
const config = defineModel<SimConfig>('config', { required: true });
const { t, num, pct } = useSimI18n();

/** Most worker processes one server's RAM can hold with the current memory settings. */
const maxWorkers = computed(() => workersThatFit(config.value.app));

/** Usual worker count: one per core for async, Gunicorn's (2 × cores) + 1 for sync. */
function recommendedWorkers(type: ServerType, vcpu: number): number {
  return type === 'sync' ? 2 * vcpu + 1 : vcpu;
}
const recommended = computed(() =>
  recommendedWorkers(config.value.app.serverType, config.value.app.vcpu),
);

/** Usual DB pool per worker: sync workers run one query at a time, async ones several. */
const DEFAULT_POOL: Record<ServerType, number> = { async: 10, sync: 1 };

/** Switching server type also resets workers and the DB pool to that type's usual defaults. */
function setServerType(type: ServerType) {
  const app = config.value.app;
  if (app.serverType === type) return;
  app.serverType = type;
  app.workers = recommendedWorkers(type, app.vcpu);
  app.poolSize = DEFAULT_POOL[type];
}

const unit = (suffix: string) => (v: number) => `${num(v)} ${suffix}`;
const VCPU = [1, 2, 4, 8, 16, 32, 64];
const RAM_GB = [0.5, 1, 2, 4, 8, 16, 32, 64, 128];
const NET_GBPS = [0.1, 0.5, 1, 2.5, 5, 10, 25];
const RESPONSE_KB = [1, 5, 10, 20, 40, 100, 250, 500, 1000, 2000];
const CPU_MS = [1, 2, 5, 10, 15, 20, 30, 50, 100, 200, 500];
const MEM_MB = [0.05, 0.1, 0.25, 0.5, 1, 5, 10, 25, 50, 100, 200, 400, 800];
const WORKER_MEM_MB = [25, 50, 100, 150, 200, 300, 500];
const SERVER_TYPES: ServerType[] = ['async', 'sync'];
/** Memory sizes under 1 MB read better in KB. */
const memory = (mb: number) => (mb < 1 ? `${num(mb * 1000)} KB` : `${num(mb)} MB`);
const QUERY_MS = [0.5, 1, 2, 4, 8, 15, 30, 50, 100, 250, 500];
const MAX_CONNECTIONS = [20, 50, 100, 200, 500, 1000, 5000];
const LB_MAX_RPS = [1000, 5000, 10_000, 25_000, 50_000, 100_000, 250_000, 1_000_000];
const CACHE_MAX_OPS = [10_000, 25_000, 50_000, 100_000, 200_000, 500_000, 1_000_000];
</script>

<template>
  <div class="controls">
    <section class="group">
      <h3 class="group-title">{{ t('presets') }}</h3>
      <div class="presets" role="group" :aria-label="t('presets')">
        <button
          v-for="id in PRESET_IDS"
          :key="id"
          type="button"
          class="preset"
          :class="{ active: activePreset === id }"
          :aria-pressed="activePreset === id"
          @click="emit('preset', id)"
        >
          {{ t(`presetList.${id}.name`) }}
        </button>
      </div>
      <p class="preset-desc">
        {{ activePreset ? t(`presetList.${activePreset}.desc`) : t('customDesc') }}
      </p>
    </section>

    <section class="group">
      <h3 class="group-title">{{ t('groups.traffic') }}</h3>
      <SliderField v-model="config.traffic.rps" :label="t('fields.rps')" log :min="1" :max="1_000_000" />
      <SliderField v-model="config.traffic.readRatio" :label="t('fields.readRatio')" :min="0" :max="1" :step="0.01" :format="pct" />
      <SliderField v-model="config.traffic.responseKB" :label="t('fields.responseKB')" :options="RESPONSE_KB" :format="unit('KB')" />
      <SliderField v-model="config.traffic.queriesPerRequest" :label="t('fields.queriesPerRequest')" :min="1" :max="20" />
    </section>

    <section class="group">
      <label class="group-title toggle">
        <span>{{ t('groups.cdn') }}</span>
        <input v-model="config.cdn.enabled" type="checkbox" role="switch" :aria-label="t('enable', { name: t('groups.cdn') })" />
      </label>
      <template v-if="config.cdn.enabled">
        <SliderField v-model="config.cdn.hitRatio" :label="t('fields.cdnHitRatio')" :min="0" :max="0.99" :step="0.01" :format="pct" />
      </template>
    </section>

    <section class="group">
      <label class="group-title toggle">
        <span>{{ t('groups.lb') }}</span>
        <input v-model="config.lb.enabled" type="checkbox" role="switch" :aria-label="t('enable', { name: t('groups.lb') })" />
      </label>
      <template v-if="config.lb.enabled">
        <SliderField v-model="config.lb.maxRps" :label="t('fields.lbMaxRps')" :options="LB_MAX_RPS" :format="unit('req/s')" />
      </template>
    </section>

    <section class="group">
      <h3 class="group-title">{{ t('groups.app') }}</h3>
      <SliderField
        v-model="config.app.count"
        :label="t('fields.appCount')"
        :min="1"
        :max="100"
        :disabled="!config.lb.enabled"
        :hint="config.lb.enabled ? undefined : t('needsLb')"
      />
      <div class="server-type">
        <span class="server-type-label">{{ t('fields.serverType') }}</span>
        <div class="segmented" role="radiogroup" :aria-label="t('fields.serverType')">
          <button
            v-for="type in SERVER_TYPES"
            :key="type"
            type="button"
            role="radio"
            :aria-checked="config.app.serverType === type"
            :class="{ active: config.app.serverType === type }"
            @click="setServerType(type)"
          >
            {{ t(`serverTypes.${type}.name`) }}
          </button>
        </div>
        <p class="server-type-desc">{{ t(`serverTypes.${config.app.serverType}.desc`) }}</p>
      </div>
      <!-- 129 = Gunicorn's guideline for the largest server, (2 × 64) + 1 -->
      <SliderField v-model="config.app.workers" :label="t('fields.workers')" :min="1" :max="129" />
      <div class="worker-hints">
        <div class="hint-row">
          <span>{{ t(`recommended.${config.app.serverType}`, { n: recommended }) }}</span>
          <button
            type="button"
            class="hint-button"
            :disabled="config.app.workers === recommended"
            :aria-label="t('useRecommendedAria', { n: recommended })"
            @click="config.app.workers = recommended"
          >
            {{ t('useRecommended') }}
          </button>
        </div>
        <div class="hint-row" :class="{ over: config.app.workers > maxWorkers }">
          <span>{{ maxWorkers > 0 ? t('maxFit', { n: maxWorkers }) : t('noneFit') }}</span>
          <button
            v-if="maxWorkers > 0"
            type="button"
            class="hint-button"
            :disabled="config.app.workers === maxWorkers"
            :aria-label="t('useMaxAria', { n: maxWorkers })"
            @click="config.app.workers = maxWorkers"
          >
            {{ t('useMax') }}
          </button>
        </div>
      </div>
      <SliderField v-model="config.app.vcpu" :label="t('fields.vcpu')" :options="VCPU" />
      <SliderField v-model="config.app.cpuMs" :label="t('fields.cpuMs')" :options="CPU_MS" :format="unit('ms')" />
      <SliderField v-model="config.app.ramGB" :label="t('fields.ramGB')" :options="RAM_GB" :format="unit('GB')" />
      <SliderField v-model="config.app.workerMemMB" :label="t('fields.workerMemMB')" :options="WORKER_MEM_MB" :format="unit('MB')" />
      <SliderField v-model="config.app.memMB" :label="t('fields.memMB')" :options="MEM_MB" :format="memory" />
      <SliderField v-model="config.app.netGbps" :label="t('fields.netGbps')" :options="NET_GBPS" :format="unit('Gbps')" />
      <SliderField v-model="config.app.poolSize" :label="t('fields.poolSize')" :min="1" :max="100" />
    </section>

    <section class="group">
      <label class="group-title toggle">
        <span>{{ t('groups.cache') }}</span>
        <input v-model="config.cache.enabled" type="checkbox" role="switch" :aria-label="t('enable', { name: t('groups.cache') })" />
      </label>
      <template v-if="config.cache.enabled">
        <SliderField v-model="config.cache.hitRatio" :label="t('fields.cacheHitRatio')" :min="0" :max="0.99" :step="0.01" :format="pct" />
        <SliderField v-model="config.cache.maxOps" :label="t('fields.cacheMaxOps')" :options="CACHE_MAX_OPS" :format="unit('ops/s')" />
      </template>
    </section>

    <section class="group">
      <h3 class="group-title">{{ t('groups.db') }}</h3>
      <SliderField v-model="config.db.vcpu" :label="t('fields.dbVcpu')" :options="VCPU" />
      <SliderField v-model="config.db.queryMs" :label="t('fields.queryMs')" :options="QUERY_MS" :format="unit('ms')" />
      <SliderField v-model="config.db.maxConnections" :label="t('fields.maxConnections')" :options="MAX_CONNECTIONS" />
      <SliderField v-model="config.db.replicas" :label="t('fields.replicas')" :min="0" :max="10" />
    </section>
  </div>
</template>

<style scoped>
.group + .group {
  margin-top: 1.125rem;
  padding-top: 1rem;
  border-top: 1px solid var(--panel-border);
}

.group-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  margin: 0 0 0.75rem;
}

.toggle {
  cursor: pointer;
}

/* Only the header row shows while a component is off */
.toggle:last-child {
  margin-bottom: 0;
}

.toggle input {
  appearance: none;
  position: relative;
  width: 2.25rem;
  height: 1.25rem;
  margin: 0;
  border-radius: 999px;
  background: var(--panel-border);
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.toggle input::after {
  content: '';
  position: absolute;
  top: 0.1875rem;
  left: 0.1875rem;
  width: 0.875rem;
  height: 0.875rem;
  border-radius: 50%;
  background: var(--color-text);
  transition: transform 0.2s ease;
}

.toggle input:checked {
  background: var(--color-primary);
}

.toggle input:checked::after {
  transform: translateX(1rem);
  background: var(--color-background);
}

.toggle input:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.server-type {
  margin: 0.875rem 0;
}

.server-type-label {
  display: block;
  font-size: 0.8125rem;
  margin-bottom: 0.375rem;
}

.segmented {
  display: flex;
  border: 1px solid var(--panel-border);
  border-radius: 8px;
  overflow: hidden;
}

.segmented button {
  flex: 1;
  font: inherit;
  font-size: 0.8125rem;
  padding: 0.375rem 0.5rem;
  border: none;
  background: transparent;
  color: var(--color-text-muted);
  cursor: pointer;
  transition: background-color 0.2s ease, color 0.2s ease;
}

.segmented button + button {
  border-left: 1px solid var(--panel-border);
}

.segmented button.active {
  color: var(--color-primary);
  font-weight: 600;
  background-color: color-mix(in srgb, var(--color-primary) 12%, transparent);
}

.segmented button:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: -2px;
}

.server-type-desc {
  margin: 0.375rem 0 0;
  font-size: 0.75rem;
  line-height: 1.5;
  color: var(--color-text-muted);
}

.worker-hints {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin: 0.375rem 0 0.875rem;
}

.hint-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  font-size: 0.75rem;
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

/* More workers configured than fit: the extra ones would be killed */
.hint-row.over {
  color: var(--util-warn);
}

.hint-button {
  flex-shrink: 0;
  font: inherit;
  font-size: 0.6875rem;
  padding: 0.125rem 0.5rem;
  border-radius: 999px;
  border: 1px solid var(--panel-border);
  background: transparent;
  color: var(--color-text);
  cursor: pointer;
  transition: border-color 0.2s ease, color 0.2s ease;
}

.hint-button:hover:not(:disabled) {
  border-color: var(--color-primary);
  color: var(--color-primary);
}

.hint-button:disabled {
  opacity: 0.4;
  cursor: default;
}

.hint-button:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.presets {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
}

.preset {
  font: inherit;
  font-size: 0.75rem;
  padding: 0.3125rem 0.625rem;
  border-radius: 999px;
  border: 1px solid var(--panel-border);
  background: transparent;
  color: var(--color-text);
  cursor: pointer;
  transition: border-color 0.2s ease, color 0.2s ease, background-color 0.2s ease;
}

.preset:hover {
  border-color: var(--color-primary);
}

.preset.active {
  border-color: var(--color-primary);
  color: var(--color-primary);
  background-color: color-mix(in srgb, var(--color-primary) 12%, transparent);
}

.preset-desc {
  margin: 0.75rem 0 0;
  font-size: 0.8125rem;
  line-height: 1.6;
  color: var(--color-text-muted);
}

@media (prefers-reduced-motion: reduce) {
  .toggle input,
  .toggle input::after {
    transition: none;
  }
}
</style>
