<script setup lang="ts">
import { computed, ref } from 'vue';
import { useParticles, type ParticleEdge, type ParticleKind } from '../../capacity-sim/components/useParticles';
import type { DistConfig, DistFlow, DistNodeId, DistResult } from '../engine/model';
import { nodeId } from '../engine/model';
import { hotShardShare, liveRegions } from '../engine/simulate';
import { edgePath, getLayout, type EdgePath, type NodeBox } from './layout';
import { useDistI18n, utilLevel } from './context';

const props = defineProps<{
  config: DistConfig;
  result: DistResult;
  selected: DistNodeId | null;
}>();
const emit = defineEmits<{ select: [id: DistNodeId]; toggleRegion: [index: number] }>();
const { t, num, pct } = useDistI18n();

const canvas = ref<HTMLCanvasElement | null>(null);

const regionCount = computed(() => Math.max(1, Math.round(props.config.regions.count)));
const live = computed(() => liveRegions(props.config.regions));
const shards = computed(() => Math.max(1, Math.round(props.config.shards.count)));

const layout = computed(() =>
  getLayout({
    regions: regionCount.value,
    home: props.result.home,
    cdn: props.config.stack.cdn.enabled,
    cache: props.config.stack.cache.enabled,
    pooler: props.config.pooler.enabled,
    replica: props.config.stack.db.replicas > 0,
  }),
);

interface NodeView extends NodeBox {
  title: string;
  subtitle: string;
  /** In a live region (the primaries are drawn only in the home region). */
  live: boolean;
  count: string | null;
  bars: { key: string; label: string; util: number; level: string }[];
  bottleneck: boolean;
  saturated: boolean;
}

function subtitle(box: NodeBox): string {
  const c = props.config;
  const region = props.result.regions[box.region];
  switch (box.kind) {
    case 'clients':
      return region?.live ? t('sub.clients', { rps: Math.round(region.rps) }) : t('rerouted');
    case 'cdn':
      return t('sub.cdn', { hit: Math.round(c.stack.cdn.hitRatio * 100) });
    case 'lb':
      return t('sub.lb', { max: c.stack.lb.maxRps });
    case 'app':
      return t('sub.app', { vcpu: c.stack.app.vcpu, ram: c.stack.app.ramGB });
    case 'cache':
      return t('sub.cache', { hit: Math.round(c.stack.cache.hitRatio * 100) });
    case 'pooler':
      return t('sub.pooler', { n: c.pooler.poolSize });
    case 'replica':
      return shards.value > 1
        ? t('sub.replicaSharded', { share: Math.round(hotShardShare(c.shards) * 100) })
        : t('sub.replica');
    case 'primary':
      if (shards.value > 1) return t('sub.primarySharded', { share: Math.round(hotShardShare(c.shards) * 100) });
      return t(c.stack.db.replicas > 0 ? 'sub.primaryWrites' : 'sub.primaryAll');
  }
}

/** "×6" for several servers; database boxes stand for one shard, so "×4 · 2" means 4 shards × 2 replicas. */
function countLabel(box: NodeBox): string | null {
  const n = props.result.nodes[box.id as DistNodeId];
  if (box.kind === 'replica' || box.kind === 'primary') {
    const per = n?.instances ?? 1;
    if (shards.value > 1) return per > 1 ? `×${shards.value} · ${per}` : `×${shards.value}`;
    return per > 1 ? `×${per}` : null;
  }
  return n && n.instances > 1 ? `×${n.instances}` : null;
}

const nodes = computed<NodeView[]>(() =>
  [...layout.value.boxes.values()].map((box) => {
    const result = box.kind === 'clients' ? undefined : props.result.nodes[box.id as DistNodeId];
    return {
      ...box,
      title: t(`nodes.${box.kind}`),
      subtitle: subtitle(box),
      live: live.value.includes(box.region),
      count: countLabel(box),
      bars: (result?.limits ?? []).map((l) => ({
        key: l.resource,
        label: t(`resShort.${l.resource}`),
        util: l.utilization,
        level: utilLevel(l.utilization),
      })),
      bottleneck: props.result.bottleneck?.node === box.id,
      saturated: !!result?.saturated,
    };
  }),
);

const bands = computed(() =>
  layout.value.bands.map((b) => ({
    ...b,
    live: live.value.includes(b.region),
    home: b.region === props.result.home,
    label: t('region', { n: b.region + 1 }),
  })),
);

function particleKind(f: DistFlow): ParticleKind {
  const to = f.to.split('@')[0];
  if (to === 'cache') return 'cache';
  return f.kind === 'request' ? 'request' : 'db';
}

const LINE_HEIGHT = 13;

/** Text for an edge's label, one string per line; fan-out edges split the rate and its kind. */
function labelLines(f: DistFlow): string[] {
  const unit = t(`unitsShort.${props.result.nodes[f.to]!.unit}`);
  const round = (v: number) => num(v >= 10 ? Math.round(v) : v);
  const kind = (k: string) => t(`flowKinds.${k}`);
  const lines: string[] = [];
  switch (f.kind) {
    case 'request':
      lines.push(`${round(f.rate)} ${unit}`);
      break;
    case 'readWrite':
      lines.push(`${round(f.reads ?? 0)} ${unit}`, kind('read'), `${round(f.writes ?? 0)} ${unit}`, kind('write'));
      break;
    default:
      lines.push(`${round(f.rate)} ${unit}`, kind(f.kind));
  }
  if (f.crossRegion) lines.push(t('crossRegionLabel', { ms: props.config.regions.crossRegionMs }));
  return lines;
}

/**
 * Where an edge's label goes. Labels along the request chain sit just after the
 * source; edges fanning out of the app or pooler share a start, so theirs go by
 * the target; a cross-region edge is labelled beside its vertical run, in the
 * empty primary column of its own region.
 */
function labelAt(f: DistFlow, path: EdgePath, lines: number) {
  const { start, end } = path;
  const block = (lines - 1) * LINE_HEIGHT;
  // Beside the vertical run, in the primary column of the edge's own region, which is empty
  if (f.crossRegion) return { x: end.x - 26, y: start.y - 8 - block, anchor: 'start' };
  if (f.kind === 'request') return { x: (start.x + end.x) / 2, y: start.y - 8, anchor: 'middle' };
  // Fan-out edges: by the target, on the side away from the curve
  if (end.y > start.y) return { x: end.x - 8, y: end.y + 18, anchor: 'end' };
  return { x: end.x - 8, y: end.y - 8 - block, anchor: 'end' };
}

const edges = computed(() =>
  props.result.flows.map((f) => {
    const path = edgePath(layout.value, f);
    const lines = labelLines(f);
    return {
      id: `${f.from}-${f.to}`,
      curve: path.curve,
      at: path.at,
      d: path.d,
      lines,
      labelPos: labelAt(f, path, lines.length),
      crossRegion: f.crossRegion,
      rate: f.rate,
      dropShare: f.dropShare,
      kind: particleKind(f),
    };
  }),
);

useParticles(
  canvas,
  computed<ParticleEdge[]>(() => edges.value),
  computed(() => layout.value.width),
);

function activate(node: NodeView) {
  if (node.kind === 'clients' || !node.live) return;
  emit('select', node.id as DistNodeId);
}

const barTrack = (w: number) => w - 24 - 34 - 40;
const canToggle = (region: number) => regionCount.value > 1 && (!live.value.includes(region) || live.value.length > 1);
</script>

<template>
  <div class="diagram-wrap">
    <div class="diagram" :style="{ aspectRatio: `${layout.width} / ${layout.height}` }">
      <svg
        class="diagram-svg"
        :viewBox="`0 0 ${layout.width} ${layout.height}`"
        role="group"
        :aria-label="t('diagramLabel')"
      >
        <!-- Region bands -->
        <g v-for="b in bands" :key="`band-${b.region}`" class="band" :class="{ down: !b.live }">
          <rect x="8" :y="b.top" :width="layout.width - 16" :height="layout.height / bands.length - 8" rx="12" class="band-box" />
          <text x="22" :y="b.top + 18" class="band-label">
            {{ b.label }}
            <tspan v-if="b.home" class="band-tag">· {{ t('home') }}</tspan>
            <tspan v-else-if="!b.live" class="band-tag down">· {{ t('down') }}</tspan>
          </text>
          <g
            v-if="canToggle(b.region)"
            class="band-toggle"
            :transform="`translate(${layout.width - 22} ${b.top + 13})`"
            role="button"
            tabindex="0"
            :aria-label="t(b.live ? 'takeDown' : 'bringBack', { n: b.region + 1 })"
            @click="emit('toggleRegion', b.region)"
            @keydown.enter.prevent="emit('toggleRegion', b.region)"
            @keydown.space.prevent="emit('toggleRegion', b.region)"
          >
            <title>{{ t(b.live ? 'takeDown' : 'bringBack', { n: b.region + 1 }) }}</title>
            <rect x="-62" y="-10" width="74" height="20" rx="10" />
            <text x="-25" y="4" text-anchor="middle">{{ t(b.live ? 'takeDownShort' : 'bringBackShort') }}</text>
          </g>
        </g>

        <g class="edges">
          <g v-for="e in edges" :key="e.id">
            <path :d="e.d" class="edge" :class="{ dropping: e.dropShare > 0.001, cross: e.crossRegion }" />
            <text class="edge-label" :y="e.labelPos.y" :text-anchor="e.labelPos.anchor">
              <tspan v-for="(line, i) in e.lines" :key="i" :x="e.labelPos.x" :dy="i === 0 ? 0 : LINE_HEIGHT">
                {{ line }}
              </tspan>
            </text>
          </g>
        </g>

        <g
          v-for="n in nodes"
          :key="n.id"
          class="node"
          :class="{
            ghost: !n.live,
            selected: selected === n.id,
            saturated: n.saturated,
            interactive: n.kind !== 'clients' && n.live,
          }"
          :transform="`translate(${n.x - n.w / 2} ${n.y - n.h / 2})`"
          :role="n.kind === 'clients' || !n.live ? undefined : 'button'"
          :tabindex="n.kind === 'clients' || !n.live ? undefined : 0"
          :aria-label="`${n.title} · ${t('region', { n: n.region + 1 })}`"
          :aria-pressed="n.kind === 'clients' || !n.live ? undefined : selected === n.id"
          @click="activate(n)"
          @keydown.enter.prevent="activate(n)"
          @keydown.space.prevent="activate(n)"
        >
          <template v-if="n.count">
            <rect class="stack" x="8" y="8" :width="n.w" :height="n.h" rx="10" />
            <rect class="stack" x="4" y="4" :width="n.w" :height="n.h" rx="10" />
          </template>
          <rect class="box" :width="n.w" :height="n.h" rx="10" />
          <text class="title" x="12" y="22">{{ n.title }}</text>
          <text v-if="n.count" class="count" :x="n.w - 12" y="22" text-anchor="end">{{ n.count }}</text>
          <text class="subtitle" x="12" y="38">{{ n.subtitle }}</text>
          <g v-for="(b, i) in n.bars" :key="b.key" :transform="`translate(12 ${50 + i * 13})`">
            <text class="bar-label" x="0" y="7">{{ b.label }}</text>
            <rect class="bar-track" x="34" y="1" :width="barTrack(n.w)" height="6" rx="3" />
            <rect class="bar-fill" :class="b.level" x="34" y="1" :width="barTrack(n.w) * Math.min(1, b.util)" height="6" rx="3" />
            <text class="bar-value" :class="b.level" :x="n.w - 24" y="7" text-anchor="end">
              {{ b.util > 9.99 ? '>999%' : pct(b.util) }}
            </text>
          </g>
          <g v-if="n.bottleneck" class="badge" :transform="`translate(${n.w / 2} -10)`">
            <rect x="-46" y="-9" width="92" height="18" rx="9" />
            <text x="0" y="4" text-anchor="middle">{{ t('bottleneckBadge') }}</text>
          </g>
        </g>
      </svg>
      <canvas ref="canvas" class="particles" aria-hidden="true" />
    </div>
  </div>
</template>

<style scoped>
.diagram-wrap {
  overflow-x: auto;
}

.diagram {
  position: relative;
  min-width: 720px;
}

.diagram-svg {
  display: block;
  width: 100%;
  height: auto;
  overflow: visible;
}

.particles {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.band-box {
  fill: var(--color-text);
  fill-opacity: 0.025;
  stroke: var(--panel-border);
  stroke-width: 1;
}

.band.down .band-box {
  fill-opacity: 0;
  stroke-dasharray: 6 5;
}

.band-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  fill: var(--color-text-muted);
}

.band-tag {
  fill: var(--color-primary);
}

.band-tag.down {
  fill: var(--util-bad);
}

.band-toggle {
  cursor: pointer;
  outline: none;
}

.band-toggle rect {
  fill: var(--node-bg);
  stroke: var(--color-text);
  stroke-opacity: 0.25;
  transition: stroke 0.2s ease;
}

.band-toggle text {
  font-size: 10px;
  font-weight: 600;
  fill: var(--color-text-muted);
}

.band-toggle:hover rect,
.band-toggle:focus-visible rect {
  stroke: var(--color-primary);
  stroke-opacity: 1;
}

.band-toggle:hover text,
.band-toggle:focus-visible text {
  fill: var(--color-primary);
}

.edge {
  fill: none;
  stroke: var(--color-text);
  stroke-opacity: 0.22;
  stroke-width: 1.5;
}

.edge.cross {
  stroke-dasharray: 3 4;
}

.edge.dropping {
  stroke: var(--util-bad);
  stroke-opacity: 0.5;
  stroke-dasharray: 5 4;
}

.edge-label {
  font-size: 11px;
  fill: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

.node {
  outline: none;
}

.node.interactive {
  cursor: pointer;
}

.box {
  fill: var(--node-bg);
  stroke: var(--color-text);
  stroke-opacity: 0.3;
  stroke-width: 1.25;
  transition: stroke 0.2s ease, stroke-opacity 0.2s ease;
}

.stack {
  fill: var(--node-bg);
  stroke: var(--color-text);
  stroke-opacity: 0.18;
}

.node.interactive:hover .box,
.node:focus-visible .box {
  stroke: var(--color-primary);
  stroke-opacity: 1;
}

.node.selected .box {
  stroke: var(--color-primary);
  stroke-opacity: 1;
  stroke-width: 2;
}

.node.saturated .box {
  stroke: var(--util-bad);
  stroke-opacity: 1;
  stroke-width: 2;
  animation: pulse 1.2s ease-in-out infinite;
}

@keyframes pulse {
  50% {
    stroke-opacity: 0.35;
  }
}

.node.ghost {
  opacity: 0.35;
}

.node.ghost .box {
  fill: transparent;
  stroke-dasharray: 6 5;
}

.title {
  font-size: 13px;
  font-weight: 600;
  fill: var(--color-text);
}

.count {
  font-size: 12px;
  font-weight: 700;
  fill: var(--color-primary);
}

.subtitle {
  font-size: 10.5px;
  fill: var(--color-text-muted);
}

.bar-label,
.bar-value {
  font-size: 9.5px;
  font-weight: 600;
  fill: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}

.bar-track {
  fill: var(--color-text);
  fill-opacity: 0.1;
}

.bar-fill {
  transition: width 0.3s ease;
}

.bar-fill.ok {
  fill: var(--util-ok);
}

.bar-fill.warn,
.bar-value.warn {
  fill: var(--util-warn);
}

.bar-fill.bad,
.bar-value.bad {
  fill: var(--util-bad);
}

.badge rect {
  fill: var(--util-bad);
}

.badge text {
  font-size: 10px;
  font-weight: 700;
  fill: var(--color-background);
}

@media (prefers-reduced-motion: reduce) {
  .node.saturated .box {
    animation: none;
  }

  .box,
  .bar-fill {
    transition: none;
  }
}
</style>
