<script setup lang="ts">
import { computed, provide, ref } from 'vue';
import { createToolI18n } from '../toolI18n';
import { nodeId, type DistConfig, type DistNodeId } from './engine/model';
import { liveRegions, simulateDistributed } from './engine/simulate';
import { DIST_PRESET_IDS, DIST_PRESETS, distPresetConfig, type DistPresetId } from './engine/presets';
import ControlsPanel from './components/ControlsPanel.vue';
import RegionsDiagram from './components/RegionsDiagram.vue';
import MetricsPanel from './components/MetricsPanel.vue';
import NodeDetails from './components/NodeDetails.vue';
import { DIST_I18N, withFormatters } from './components/context';

const props = defineProps<{ locale: string }>();
const i18n = withFormatters(createToolI18n(props.locale, 'tools.distributedSim'));
provide(DIST_I18N, i18n);
const { t } = i18n;

const config = ref<DistConfig>(distPresetConfig('oneRegion'));
const result = computed(() => simulateDistributed(config.value));

// A scenario stays highlighted until any value is changed
const activePreset = computed<DistPresetId | null>(() => {
  const current = JSON.stringify(config.value);
  return DIST_PRESET_IDS.find((id) => JSON.stringify(DIST_PRESETS[id]) === current) ?? null;
});

function applyPreset(id: DistPresetId) {
  config.value = distPresetConfig(id);
  selected.value = null;
}

const selected = ref<DistNodeId | null>(null);
/** Shown in the details panel: the clicked node, else the bottleneck. */
const detailsNode = computed<DistNodeId>(() => {
  const s = selected.value;
  if (s && result.value.nodes[s]) return s;
  return result.value.bottleneck?.node ?? nodeId('app', result.value.home);
});

/** Takes a region down or brings it back; at least one region stays up. */
function toggleRegion(index: number) {
  const regions = config.value.regions;
  const down = regions.down.filter((i) => i < regions.count);
  if (down.includes(index)) {
    regions.down = down.filter((i) => i !== index);
  } else if (liveRegions(regions).length > 1) {
    regions.down = [...down, index].sort((a, b) => a - b);
  }
}
</script>

<template>
  <div class="sim">
    <aside class="panel controls">
      <h2 class="panel-title">{{ t('controls') }}</h2>
      <ControlsPanel
        v-model:config="config"
        :active-preset="activePreset"
        @preset="applyPreset"
        @toggle-region="toggleRegion"
      />
    </aside>

    <div class="panel diagram">
      <RegionsDiagram
        :config="config"
        :result="result"
        :selected="selected"
        @select="selected = $event"
        @toggle-region="toggleRegion"
      />
    </div>

    <div class="panel metrics">
      <h2 class="panel-title">{{ t('metrics') }}</h2>
      <MetricsPanel :config="config" :result="result" />
    </div>

    <div class="panel details">
      <NodeDetails :config="config" :result="result" :node-id="detailsNode" />
      <p class="hint">{{ t('details.hint') }}</p>
    </div>
  </div>
</template>

<style scoped>
.sim {
  --panel-border: rgba(255, 255, 255, 0.12);
  --panel-bg: rgba(255, 255, 255, 0.02);
  --node-bg: #23232b;
  --util-ok: var(--color-primary);
  --util-warn: #ffb454;
  --util-bad: var(--color-pink);
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-areas:
    'diagram'
    'metrics'
    'controls'
    'details';
  gap: 1rem;
  align-items: start;
}

.controls {
  grid-area: controls;
}

.diagram {
  grid-area: diagram;
}

.metrics {
  grid-area: metrics;
}

.details {
  grid-area: details;
}

[data-theme='light'] .sim {
  --panel-border: rgba(0, 0, 0, 0.18);
  --panel-bg: rgba(0, 0, 0, 0.02);
  --node-bg: #ffffff;
  --util-warn: #c26a00;
}

@media (min-width: 900px) {
  .sim {
    grid-template-columns: minmax(300px, 340px) minmax(0, 1fr);
    grid-template-rows: auto auto 1fr;
    grid-template-areas:
      'controls diagram'
      'controls metrics'
      'controls details';
  }

  .panel.controls {
    position: sticky;
    top: 1rem;
    max-height: calc(100vh - 2rem);
    overflow-y: auto;
    padding-right: 0.5rem;
    scrollbar-width: thin;
    scrollbar-color: transparent transparent;
    transition: scrollbar-color 0.2s ease;
  }

  .panel.controls:hover,
  .panel.controls:focus-within {
    scrollbar-color: var(--panel-border) transparent;
  }
}

.panel {
  border: 1px solid var(--panel-border);
  border-radius: 12px;
  background-color: var(--panel-bg);
  padding: 1rem 1.25rem;
  min-width: 0;
}

.panel-title {
  font-size: 1rem;
  font-weight: 600;
  margin: 0 0 1rem;
}

.hint {
  margin: 1rem 0 0;
  font-size: 0.75rem;
  color: var(--color-text-muted);
}
</style>
