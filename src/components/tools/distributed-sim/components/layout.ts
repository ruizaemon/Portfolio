import { curvePath, pointOnCurve, type Curve, type Point } from '../../capacity-sim/components/layout';
import { nodeId, type DistFlow, type DistNodeId, type NodeKind } from '../engine/model';

export { curvePath, pointOnCurve };
export type { Curve, Point };

export type DiagramNodeId = DistNodeId | `clients@${number}`;

/** Which columns the diagram has, left to right; the data column stacks cache, pooler and replicas. */
export type Column = 'clients' | 'cdn' | 'lb' | 'app' | 'data' | 'primary';

export interface NodeBox {
  id: DiagramNodeId;
  kind: NodeKind | 'clients';
  region: number;
  /** Centre. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Band {
  region: number;
  top: number;
  /** Vertical centre of the request chain. */
  cy: number;
}

export interface DiagramLayout {
  width: number;
  height: number;
  bands: Band[];
  boxes: Map<DiagramNodeId, NodeBox>;
}

export const NODE_W = 138;
/** Main chain nodes, and the shorter data-tier nodes beside them. */
export const NODE_H = 96;
export const DATA_H = 84;
/** Column pitch along the request chain; the data and primary columns get wider gaps for labels. */
const PITCH = 213;
const DATA_GAP = 100;
const PRIMARY_GAP = 80;
export const BAND_H = 310;
const TOP = 24;

export interface LayoutInput {
  regions: number;
  home: number;
  cdn: boolean;
  cache: boolean;
  pooler: boolean;
  replica: boolean;
}

/**
 * One horizontal band per region: clients → CDN → load balancer → app, then
 * the region's data tier stacked in one column. The primaries sit in the home
 * region's band, in a column of their own, so every region's writes can reach
 * them without crossing another box.
 */
export function getLayout(input: LayoutInput): DiagramLayout {
  const chain: Column[] = ['clients'];
  if (input.cdn) chain.push('cdn');
  chain.push('lb', 'app');
  const colX = new Map<Column, number>();
  chain.forEach((c, i) => colX.set(c, 20 + NODE_W / 2 + i * PITCH));
  const dataX = colX.get('app')! + NODE_W + DATA_GAP;
  colX.set('data', dataX);
  colX.set('primary', dataX + NODE_W + PRIMARY_GAP);

  const boxes = new Map<DiagramNodeId, NodeBox>();
  const bands: Band[] = [];
  const place = (id: DiagramNodeId, kind: NodeBox['kind'], region: number, x: number, y: number, h: number) =>
    boxes.set(id, { id, kind, region, x, y, w: NODE_W, h });

  const dataKinds = (['cache', 'pooler', 'replica'] as const).filter((k) => input[k]);

  for (let r = 0; r < input.regions; r++) {
    const top = TOP + r * BAND_H;
    const cy = top + BAND_H / 2 + 8;
    bands.push({ region: r, top, cy });
    place(`clients@${r}`, 'clients', r, colX.get('clients')!, cy, NODE_H);
    if (input.cdn) place(nodeId('cdn', r), 'cdn', r, colX.get('cdn')!, cy, NODE_H);
    place(nodeId('lb', r), 'lb', r, colX.get('lb')!, cy, NODE_H);
    place(nodeId('app', r), 'app', r, colX.get('app')!, cy, NODE_H);

    // Data nodes leave the centre line free when they can, for the edge to the primary
    const slots =
      dataKinds.length === 3
        ? [cy - 96, cy, cy + 96]
        : dataKinds.length === 2
          ? [cy - 56, cy + 56]
          : dataKinds[0] === 'replica'
            ? [cy + 56]
            : [cy - 56];
    dataKinds.forEach((kind, i) => place(nodeId(kind, r), kind, r, colX.get('data')!, slots[i], DATA_H));
  }
  const home = bands[Math.min(input.home, bands.length - 1)];
  place(nodeId('primary', home.region), 'primary', home.region, colX.get('primary')!, home.cy, NODE_H);

  return {
    width: colX.get('primary')! + NODE_W / 2 + 20,
    height: TOP + input.regions * BAND_H,
    bands,
    boxes,
  };
}

export interface EdgePath {
  d: string;
  /** Position along the edge for 0–1. */
  at: (t: number) => Point;
  /** The last curve of the path, for code that wants a single cubic. */
  curve: Curve;
  start: Point;
  end: Point;
}

/** A path through the given points, parameterised by distance. */
function polyline(points: Point[]): (t: number) => Point {
  const lengths = [0];
  for (let i = 1; i < points.length; i++) {
    lengths.push(lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  }
  const total = lengths[lengths.length - 1];
  return (t: number) => {
    const target = Math.max(0, Math.min(1, t)) * total;
    let i = 1;
    while (i < points.length - 1 && lengths[i] < target) i++;
    const seg = lengths[i] - lengths[i - 1];
    const u = seg > 0 ? (target - lengths[i - 1]) / seg : 0;
    return {
      x: points[i - 1].x + (points[i].x - points[i - 1].x) * u,
      y: points[i - 1].y + (points[i].y - points[i - 1].y) * u,
    };
  };
}

/**
 * Path from the right side of `from` to the left side of `to`. A cross-region
 * edge runs straight to the gutter before the primary column, then S-curves up
 * or down to the primary, so it never crosses another region's boxes.
 */
export function edgePath(layout: DiagramLayout, flow: DistFlow): EdgePath {
  const a = layout.boxes.get(flow.from)!;
  const b = layout.boxes.get(flow.to)!;
  const start = { x: a.x + a.w / 2, y: a.y };
  const end = { x: b.x - b.w / 2, y: b.y };
  if (flow.crossRegion) {
    const gutter = end.x - PRIMARY_GAP / 2;
    const turn = { x: gutter - 24, y: start.y };
    const curve: Curve = [turn, { x: gutter + 10, y: start.y }, { x: gutter + 10, y: end.y }, end];
    const samples: Point[] = [start];
    for (let i = 0; i <= 24; i++) samples.push(pointOnCurve(curve, i / 24));
    return {
      d: `M${start.x} ${start.y} L${turn.x} ${turn.y} ${curvePath(curve).replace(/^M[^C]*/, '')}`,
      at: polyline(samples),
      curve,
      start,
      end,
    };
  }
  const mid = (start.x + end.x) / 2;
  const curve: Curve = [start, { x: mid, y: start.y }, { x: mid, y: end.y }, end];
  return { d: curvePath(curve), at: (t) => pointOnCurve(curve, t), curve, start, end };
}
