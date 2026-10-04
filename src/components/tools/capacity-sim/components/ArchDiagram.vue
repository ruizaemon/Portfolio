<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { Flow, NodeId, SimConfig, SimResult } from '../engine/model';
import {
  curvePath,
  edgeCurve,
  getLayout,
  pointOnCurve,
  type Curve,
  type DiagramNodeId,
  type Orientation,
} from './layout';
import { useParticles, type ParticleEdge, type ParticleKind } from './useParticles';
import { useSimI18n, utilLevel } from './context';

const props = defineProps<{
  config: SimConfig;
  result: SimResult;
  selected: NodeId | null;
}>();
const emit = defineEmits<{ select: [id: NodeId]; toggle: [id: NodeId] }>();
const { t, num, pct } = useSimI18n();

const container = ref<HTMLElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const orientation = ref<Orientation>('horizontal');
const layout = computed(() => getLayout(orientation.value));

let resizeObserver: ResizeObserver | undefined;
onMounted(() => {
  resizeObserver = new ResizeObserver(([entry]) => {
    orientation.value = entry.contentRect.width < 620 ? 'vertical' : 'horizontal';
  });
  if (container.value) resizeObserver.observe(container.value);
});
onBeforeUnmount(() => resizeObserver?.disconnect());

const ORDER: DiagramNodeId[] = ['clients', 'cdn', 'lb', 'app', 'cache', 'dbPrimary', 'dbReplica'];

interface NodeView {
  id: DiagramNodeId;
  x: number;
  y: number;
  title: string;
  subtitle: string;
  enabled: boolean;
  instances: number;
  bars: { key: string; label: string; util: number; level: string }[];
  bottleneck: boolean;
  saturated: boolean;
  /** Can be switched off from the diagram (CDN, load balancer, cache, replicas). */
  optional: boolean;
}

const OPTIONAL: DiagramNodeId[] = ['cdn', 'lb', 'cache', 'dbReplica'];

function subtitle(id: DiagramNodeId): string {
  const c = props.config;
  switch (id) {
    case 'clients':
      return t('sub.clients', { rps: c.traffic.rps });
    case 'cdn':
      return t('sub.cdn', { hit: Math.round(c.cdn.hitRatio * 100) });
    case 'lb':
      return t('sub.lb', { max: c.lb.maxRps });
    case 'app':
      return t('sub.app', { vcpu: c.app.vcpu, ram: c.app.ramGB });
    case 'cache':
      return t('sub.cache', { hit: Math.round(c.cache.hitRatio * 100) });
    case 'dbPrimary':
      return t(props.result.nodes.dbReplica ? 'sub.dbPrimaryWrites' : 'sub.dbPrimaryAll');
    case 'dbReplica':
      return t('sub.dbReplica');
  }
}

const nodes = computed<NodeView[]>(() =>
  ORDER.map((id) => {
    const result = id === 'clients' ? undefined : props.result.nodes[id];
    const { x, y } = layout.value.pos[id];
    return {
      id,
      x,
      y,
      title: t(`nodes.${id}`),
      subtitle: subtitle(id),
      enabled: id === 'clients' || !!result,
      instances: result?.instances ?? 1,
      bars: (result?.limits ?? []).map((l) => ({
        key: l.resource,
        label: t(`resShort.${l.resource}`),
        util: l.utilization,
        level: utilLevel(l.utilization),
      })),
      bottleneck: props.result.bottleneck?.node === id,
      saturated: !!result?.saturated,
      optional: OPTIONAL.includes(id),
    };
  }),
);

function particleKind(f: Flow): ParticleKind {
  if (f.to === 'cache') return 'cache';
  return f.kind === 'request' ? 'request' : 'db';
}

/**
 * Text for an edge's label, one string per line. Database traffic says what it
 * is, e.g. "2.4K q/s (read)"; narrow layouts split that over two lines.
 */
function labelLines(f: Flow): string[] {
  const unit = t(`unitsShort.${props.result.nodes[f.to]!.unit}`);
  // Whole numbers read better on a busy diagram, except for tiny rates
  const round = (v: number) => num(v >= 10 ? Math.round(v) : v);
  const rate = `${round(f.rate)} ${unit}`;
  const kind = (k: string) => t(`flowKinds.${k}`);
  const wide = orientation.value === 'horizontal';
  switch (f.kind) {
    case 'request':
      return [rate];
    case 'readWrite':
      return [
        `${round(f.reads ?? 0)} ${unit} ${kind('read')}`,
        `${round(f.writes ?? 0)} ${unit} ${kind('write')}`,
      ];
    case 'replication':
      return wide ? [rate, kind('replication')] : [`${rate} ${kind('replication')}`];
    default:
      return wide ? [`${rate} ${kind(f.kind)}`] : [rate, kind(f.kind)];
  }
}

const LINE_HEIGHT = 13;

/**
 * Where an edge's label goes (the first line's baseline). Request-chain labels
 * sit just after the source, since the gap between columns is always free.
 * Edges from the app share a start point, so theirs go near the target.
 * Replication labels sit beside the primary → replica line.
 */
function labelAt(f: Flow, curve: Curve, lines: number) {
  const [start, , , end] = curve;
  const mid = pointOnCurve(curve, 0.5);
  const block = (lines - 1) * LINE_HEIGHT;
  if (orientation.value === 'horizontal') {
    if (f.kind === 'replication') {
      // Left of the line, between the primary and the replica's (possible) bottleneck badge
      const centre = (start.y + end.y - 19) / 2;
      return { x: start.x - 8, y: centre - block / 2 + 4, anchor: 'end' };
    }
    if (f.from === 'app') return { x: end.x - 8, y: end.y - 8 - block, anchor: 'end' };
    return { x: start.x + 8, y: start.y - 8, anchor: 'start' };
  }
  if (f.kind === 'replication') return { x: mid.x, y: mid.y + 16, anchor: 'middle' };
  if (f.from === 'app') {
    // Cache, primary and replica labels sit side by side: push the outer ones outward
    const anchor = f.to === 'cache' ? 'end' : f.to === 'dbReplica' ? 'start' : 'middle';
    const x = anchor === 'end' ? mid.x - 6 : anchor === 'start' ? mid.x + 6 : mid.x;
    return { x, y: mid.y - block / 2 - 2, anchor };
  }
  return { x: start.x + 8, y: start.y + 16, anchor: 'start' };
}

const edges = computed(() =>
  props.result.flows.map((f) => {
    const curve = edgeCurve(layout.value, f.from, f.to);
    const lines = labelLines(f);
    return {
      id: `${f.from}-${f.to}`,
      curve,
      d: curvePath(curve),
      lines,
      labelPos: labelAt(f, curve, lines.length),
      replication: f.kind === 'replication',
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
  if (node.id === 'clients') return;
  if (node.enabled) emit('select', node.id);
  else emit('toggle', node.id);
}

const barTrack = computed(() => layout.value.nodeW - 24 - 34 - 40);
</script>

<template>
  <div ref="container" class="diagram" :class="orientation">
    <svg
      class="diagram-svg"
      :viewBox="`0 0 ${layout.width} ${layout.height}`"
      role="group"
      :aria-label="t('diagramLabel')"
    >
      <g class="edges">
        <g v-for="e in edges" :key="e.id">
          <path
            :d="e.d"
            class="edge"
            :class="{ dropping: e.dropShare > 0.001, replication: e.replication }"
          />
          <text class="edge-label" :y="e.labelPos.y" :text-anchor="e.labelPos.anchor">
            <tspan
              v-for="(line, i) in e.lines"
              :key="i"
              :x="e.labelPos.x"
              :dy="i === 0 ? 0 : LINE_HEIGHT"
            >
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
          ghost: !n.enabled,
          selected: selected === n.id,
          saturated: n.saturated,
          interactive: n.id !== 'clients',
        }"
        :transform="`translate(${n.x - layout.nodeW / 2} ${n.y - layout.nodeH / 2})`"
        :role="n.id === 'clients' ? undefined : 'button'"
        :tabindex="n.id === 'clients' ? undefined : 0"
        :aria-label="n.enabled ? n.title : `${n.title}: ${t('nodeOff')}`"
        :aria-pressed="n.id === 'clients' || !n.enabled ? undefined : selected === n.id"
        @click="activate(n)"
        @keydown.enter.prevent="activate(n)"
        @keydown.space.prevent="activate(n)"
      >
        <template v-if="n.instances > 1">
          <rect class="stack" x="10" y="10" :width="layout.nodeW" :height="layout.nodeH" rx="10" />
          <rect class="stack" x="5" y="5" :width="layout.nodeW" :height="layout.nodeH" rx="10" />
        </template>
        <rect class="box" :width="layout.nodeW" :height="layout.nodeH" rx="10" />
        <text class="title" x="12" y="24">{{ n.title }}</text>
        <text
          v-if="n.instances > 1"
          class="count"
          :x="layout.nodeW - 12"
          y="24"
          text-anchor="end"
        >
          ×{{ n.instances }}
        </text>

        <template v-if="n.enabled">
          <text class="subtitle" x="12" y="42">{{ n.subtitle }}</text>
          <g v-for="(b, i) in n.bars" :key="b.key" :transform="`translate(12 ${56 + i * 13})`">
            <text class="bar-label" x="0" y="7">{{ b.label }}</text>
            <rect class="bar-track" x="34" y="1" :width="barTrack" height="6" rx="3" />
            <rect
              class="bar-fill"
              :class="b.level"
              x="34"
              y="1"
              :width="barTrack * Math.min(1, b.util)"
              height="6"
              rx="3"
            />
            <text class="bar-value" :class="b.level" :x="layout.nodeW - 24" y="7" text-anchor="end">
              {{ b.util > 9.99 ? '>999%' : pct(b.util) }}
            </text>
          </g>
        </template>
        <text v-else class="subtitle" x="12" y="42">{{ t('nodeOff') }}</text>

        <g v-if="n.bottleneck" class="badge" :transform="`translate(${layout.nodeW / 2} -10)`">
          <rect x="-46" y="-9" width="92" height="18" rx="9" />
          <text x="0" y="4" text-anchor="middle">{{ t('bottleneckBadge') }}</text>
        </g>
      </g>

      <!-- Off buttons sit on each box's top-right corner, outside the node groups
           so they aren't a button inside a button -->
      <g
        v-for="n in nodes.filter((node) => node.optional && node.enabled)"
        :key="`off-${n.id}`"
        class="off-button"
        :transform="`translate(${n.x + layout.nodeW / 2} ${n.y - layout.nodeH / 2})`"
        role="button"
        tabindex="0"
        :aria-label="t('turnOff', { name: n.title })"
        @click="emit('toggle', n.id as NodeId)"
        @keydown.enter.prevent="emit('toggle', n.id as NodeId)"
        @keydown.space.prevent="emit('toggle', n.id as NodeId)"
      >
        <title>{{ t('turnOff', { name: n.title }) }}</title>
        <circle r="8" />
        <path d="M-3 -3 L3 3 M3 -3 L-3 3" />
      </g>
    </svg>
    <canvas ref="canvas" class="particles" aria-hidden="true" />
  </div>
</template>

<style scoped>
.diagram {
  position: relative;
  margin: 0 auto;
}

.diagram.vertical {
  max-width: 440px;
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

.edge {
  fill: none;
  stroke: var(--color-text);
  stroke-opacity: 0.22;
  stroke-width: 1.5;
}

/* Replication isn't sent by the app; the primary streams it to the replicas */
.edge.replication {
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
  opacity: 0.5;
}

.node.ghost .box {
  fill: transparent;
  stroke-dasharray: 6 5;
}

.node.ghost:hover,
.node.ghost:focus-visible {
  opacity: 0.9;
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

.off-button {
  cursor: pointer;
  outline: none;
}

.off-button circle {
  fill: var(--node-bg);
  stroke: var(--color-text);
  stroke-opacity: 0.25;
  transition: stroke 0.2s ease, fill 0.2s ease;
}

.off-button path {
  stroke: var(--color-text-muted);
  stroke-width: 1.5;
  stroke-linecap: round;
  transition: stroke 0.2s ease;
}

.off-button:hover circle,
.off-button:focus-visible circle {
  stroke: var(--util-bad);
  stroke-opacity: 1;
  fill: color-mix(in srgb, var(--util-bad) 15%, var(--node-bg));
}

.off-button:hover path,
.off-button:focus-visible path {
  stroke: var(--util-bad);
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
