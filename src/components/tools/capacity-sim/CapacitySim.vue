<script setup lang="ts">
import { computed, provide, ref } from 'vue';
import { createToolI18n } from '../toolI18n';
import type { NodeId, SimConfig } from './engine/model';
import { simulate } from './engine/simulate';
import { PRESET_IDS, PRESETS, presetConfig, type PresetId } from './engine/presets';
import ControlsPanel from './components/ControlsPanel.vue';
import ArchDiagram from './components/ArchDiagram.vue';
import MetricsPanel from './components/MetricsPanel.vue';
import NodeDetails from './components/NodeDetails.vue';
import { SIM_I18N, withFormatters } from './components/context';

const props = defineProps<{ locale: string }>();
const i18n = withFormatters(createToolI18n(props.locale, 'tools.capacitySim'));
provide(SIM_I18N, i18n);
const { t } = i18n;

const config = ref<SimConfig>(presetConfig('oneVps'));
const result = computed(() => simulate(config.value));

// A scenario stays highlighted until any value is changed
const activePreset = computed<PresetId | null>(() => {
  const current = JSON.stringify(config.value);
  return PRESET_IDS.find((id) => JSON.stringify(PRESETS[id]) === current) ?? null;
});

function applyPreset(id: PresetId) {
  config.value = presetConfig(id);
  selected.value = null;
}

const selected = ref<NodeId | null>(null);
/** Shown in the details panel: the clicked node, else the bottleneck. */
const detailsNode = computed<NodeId>(() => {
  const s = selected.value;
  if (s && result.value.nodes[s]) return s;
  return result.value.bottleneck?.node ?? 'app';
});

function toggle(id: NodeId) {
  const c = config.value;
  if (id === 'cdn') c.cdn.enabled = !c.cdn.enabled;
  else if (id === 'lb') c.lb.enabled = !c.lb.enabled;
  else if (id === 'cache') c.cache.enabled = !c.cache.enabled;
  else if (id === 'dbReplica') c.db.replicas = c.db.replicas > 0 ? 0 : 1;
  selected.value = id;
}
</script>

<template>
  <div class="sim">
    <aside class="panel controls">
      <h2 class="panel-title">{{ t('controls') }}</h2>
      <ControlsPanel v-model:config="config" :active-preset="activePreset" @preset="applyPreset" />
    </aside>

    <div class="panel diagram">
      <ArchDiagram
        :config="config"
        :result="result"
        :selected="selected"
        @select="selected = $event"
        @toggle="toggle"
      />
    </div>

    <div class="panel metrics">
      <h2 class="panel-title">{{ t('metrics') }}</h2>
      <MetricsPanel :config="config" :result="result" />
    </div>

    <div class="panel details">
      <NodeDetails :result="result" :node-id="detailsNode" />
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
  /* Phones: see the diagram and results first, then tweak */
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

:global([data-theme='light']) .sim {
  --panel-border: rgba(0, 0, 0, 0.18);
  --panel-bg: rgba(0, 0, 0, 0.02);
  --node-bg: #ffffff;
  --util-warn: #c26a00;
}

@media (min-width: 900px) {
  .sim {
    grid-template-columns: minmax(260px, 300px) minmax(0, 1fr);
    grid-template-rows: auto auto 1fr;
    grid-template-areas:
      'controls diagram'
      'controls metrics'
      'controls details';
  }

  /* Keep the controls in view while the diagram reacts */
  .panel.controls {
    position: sticky;
    top: 1rem;
    max-height: calc(100vh - 2rem);
    overflow-y: auto;
    /* Slim scrollbar against the border, only visible while hovering the panel */
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
