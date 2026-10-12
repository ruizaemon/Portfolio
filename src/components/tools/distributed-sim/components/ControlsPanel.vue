<script setup lang="ts">
import { computed } from 'vue';
import SliderField from '../../capacity-sim/components/SliderField.vue';
import ControlGroup from '../../capacity-sim/components/ControlGroup.vue';
import SwitchField from './SwitchField.vue';
import type { DistConfig } from '../engine/model';
import { hotShardShare, liveRegions } from '../engine/simulate';
import { DIST_PRESET_IDS, type DistPresetId } from '../engine/presets';
import { useDistI18n } from './context';

defineProps<{ activePreset: DistPresetId | null }>();
const emit = defineEmits<{ preset: [id: DistPresetId]; toggleRegion: [index: number] }>();
const config = defineModel<DistConfig>('config', { required: true });
const { t, num, pct } = useDistI18n();

const live = computed(() => liveRegions(config.value.regions));
const regionCount = computed(() => Math.max(1, Math.round(config.value.regions.count)));
const hot = computed(() => hotShardShare(config.value.shards));

/** One line per group header, so a folded group still shows what's set. */
const summary = computed(() => {
  const c = config.value;
  const on = t('summary.on');
  const off = t('summary.off');
  return {
    traffic: t('summary.traffic', { rps: num(c.stack.traffic.rps), reads: pct(c.stack.traffic.readRatio) }),
    regions:
      regionCount.value === 1
        ? t('summary.oneRegion')
        : t('summary.regions', { live: live.value.length, count: regionCount.value, ms: c.regions.crossRegionMs }),
    stack: t('summary.stack', { count: c.stack.app.count, vcpu: c.stack.app.vcpu }),
    db: t('summary.db', { shards: c.shards.count, replicas: c.stack.db.replicas, vcpu: c.stack.db.vcpu }),
    pooler: c.pooler.enabled ? t('summary.pooler', { n: c.pooler.poolSize }) : off,
    resilience: t('summary.resilience', {
      retries: c.retries.attempts,
      shedding: c.shedding.enabled ? on : off,
    }),
  };
});

/** App vCPU also sets one async worker per core, as part 1 recommends, so the cores are used. */
const appVcpu = computed({
  get: () => config.value.stack.app.vcpu,
  set: (v: number) => {
    config.value.stack.app.vcpu = v;
    config.value.stack.app.workers = v;
  },
});

const unit = (suffix: string) => (v: number) => `${num(v)} ${suffix}`;
const VCPU = [1, 2, 4, 8, 16, 32, 64];
const CROSS_MS = [10, 20, 40, 60, 80, 120, 160, 250];
const MAX_CONNECTIONS = [20, 50, 100, 200, 500, 1000, 5000];
const POOL_SIZE = [5, 10, 20, 50, 100, 200, 500];
const SHARDS = [1, 2, 4, 8, 16, 32];
</script>

<template>
  <div class="controls">
    <section class="scenarios">
      <h3 class="scenarios-title">{{ t('presets') }}</h3>
      <div class="presets" role="group" :aria-label="t('presets')">
        <button
          v-for="id in DIST_PRESET_IDS"
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

    <ControlGroup :title="t('groups.traffic')" :summary="summary.traffic">
      <SliderField v-model="config.stack.traffic.rps" :label="t('fields.rps')" log :min="1" :max="1_000_000" />
      <SliderField v-model="config.stack.traffic.readRatio" :label="t('fields.readRatio')" :min="0" :max="1" :step="0.01" :format="pct" />
    </ControlGroup>

    <ControlGroup :title="t('groups.regions')" :summary="summary.regions">
      <SliderField v-model="config.regions.count" :label="t('fields.regionCount')" :min="1" :max="5" />
      <SliderField
        v-model="config.regions.crossRegionMs"
        :label="t('fields.crossRegionMs')"
        :options="CROSS_MS"
        :format="unit('ms')"
        :disabled="regionCount === 1"
      />
      <div v-if="regionCount > 1" class="region-list">
        <span class="region-list-label">{{ t('regionList') }}</span>
        <div class="region-chips">
          <button
            v-for="i in regionCount"
            :key="i"
            type="button"
            class="region-chip"
            :class="{ down: !live.includes(i - 1) }"
            :aria-pressed="!live.includes(i - 1)"
            :aria-label="t(live.includes(i - 1) ? 'takeDown' : 'bringBack', { n: i })"
            @click="emit('toggleRegion', i - 1)"
          >
            {{ t('regionChip', { n: i }) }}
            <span v-if="i - 1 === live[0]" class="chip-tag">{{ t('home') }}</span>
            <span v-else-if="!live.includes(i - 1)" class="chip-tag">{{ t('down') }}</span>
          </button>
        </div>
        <p class="region-hint">{{ t('regionHint') }}</p>
      </div>
    </ControlGroup>

    <ControlGroup :title="t('groups.stack')" :summary="summary.stack">
      <p class="group-note">{{ t('stackNote') }}</p>
      <SliderField v-model="config.stack.app.count" :label="t('fields.appCount')" :min="1" :max="50" />
      <SliderField v-model="appVcpu" :label="t('fields.vcpu')" :options="VCPU" />
      <SwitchField v-model="config.stack.cdn.enabled" :label="t('fields.cdn', { hit: pct(config.stack.cdn.hitRatio) })" />
      <SwitchField v-model="config.stack.cache.enabled" :label="t('fields.cache', { hit: pct(config.stack.cache.hitRatio) })" />
    </ControlGroup>

    <ControlGroup :title="t('groups.db')" :summary="summary.db">
      <SliderField v-model="config.shards.count" :label="t('fields.shards')" :options="SHARDS" />
      <SliderField
        v-model="config.shards.hotShare"
        :label="t('fields.hotShare')"
        :min="0"
        :max="1"
        :step="0.01"
        :format="() => pct(hot)"
        :disabled="config.shards.count <= 1"
        :hint="config.shards.count > 1 ? t('hotShareHint', { even: pct(1 / config.shards.count) }) : undefined"
      />
      <SliderField v-model="config.stack.db.replicas" :label="t('fields.replicas')" :min="0" :max="5" />
      <SliderField v-model="config.stack.db.vcpu" :label="t('fields.dbVcpu')" :options="VCPU" />
      <SliderField v-model="config.stack.db.maxConnections" :label="t('fields.maxConnections')" :options="MAX_CONNECTIONS" />
    </ControlGroup>

    <ControlGroup
      with-switch
      v-model:enabled="config.pooler.enabled"
      :title="t('groups.pooler')"
      :summary="summary.pooler"
      :toggle-label="t('enable', { name: t('groups.pooler') })"
    >
      <p class="group-note">{{ t('poolerNote') }}</p>
      <SliderField v-model="config.pooler.poolSize" :label="t('fields.poolSize')" :options="POOL_SIZE" />
    </ControlGroup>

    <ControlGroup :title="t('groups.resilience')" :summary="summary.resilience">
      <SliderField v-model="config.retries.attempts" :label="t('fields.retries')" :min="0" :max="3" />
      <SwitchField
        v-model="config.retries.budget"
        :label="t('fields.retryBudget')"
        :hint="t('retryBudgetHint')"
        :disabled="config.retries.attempts === 0"
      />
      <SwitchField v-model="config.shedding.enabled" :label="t('fields.shedding')" :hint="t('sheddingHint')" />
      <SliderField
        v-model="config.shedding.threshold"
        :label="t('fields.shedThreshold')"
        :min="0.5"
        :max="1"
        :step="0.05"
        :format="pct"
        :disabled="!config.shedding.enabled"
      />
    </ControlGroup>
  </div>
</template>

<style scoped>
.controls {
  display: flex;
  flex-direction: column;
  gap: 0.625rem;
}

.scenarios {
  margin-bottom: 0.375rem;
}

.scenarios-title {
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-muted);
  margin: 0 0 0.625rem;
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

.preset:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.preset-desc {
  margin: 0.625rem 0 0;
  font-size: 0.8125rem;
  line-height: 1.6;
  color: var(--color-text-muted);
}

.group-note {
  margin: 0 0 0.625rem;
  font-size: 0.75rem;
  line-height: 1.5;
  color: var(--color-text-muted);
}

.region-list {
  margin-top: 0.75rem;
}

.region-list-label {
  display: block;
  font-size: 0.8125rem;
  margin-bottom: 0.375rem;
}

.region-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.375rem;
}

.region-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  font: inherit;
  font-size: 0.75rem;
  padding: 0.25rem 0.625rem;
  border-radius: 999px;
  border: 1px solid var(--panel-border);
  background: transparent;
  color: var(--color-text);
  cursor: pointer;
  transition: border-color 0.2s ease, color 0.2s ease, background-color 0.2s ease;
}

.region-chip:hover {
  border-color: var(--color-primary);
}

.region-chip.down {
  border-color: color-mix(in srgb, var(--util-bad) 60%, transparent);
  color: var(--color-text-muted);
  text-decoration: line-through;
}

.region-chip.down .chip-tag {
  color: var(--util-bad);
  text-decoration: none;
}

.region-chip:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.chip-tag {
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--color-primary);
}

.region-hint {
  margin: 0.375rem 0 0;
  font-size: 0.75rem;
  line-height: 1.5;
  color: var(--color-text-muted);
}
</style>
