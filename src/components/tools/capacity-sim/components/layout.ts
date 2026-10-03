import type { NodeId } from '../engine/model';

export type DiagramNodeId = 'clients' | NodeId;
export type Orientation = 'horizontal' | 'vertical';

export interface Point {
  x: number;
  y: number;
}

/** Cubic bézier in diagram (viewBox) coordinates. */
export type Curve = [Point, Point, Point, Point];

export interface DiagramLayout {
  orientation: Orientation;
  width: number;
  height: number;
  nodeW: number;
  nodeH: number;
  /** Node centers. */
  pos: Record<DiagramNodeId, Point>;
}

export const NODE_H = 112;

/**
 * Fixed pipeline: clients → CDN → load balancer → app servers → data tier,
 * where the data tier stacks cache, primary and replicas side by side.
 * Vertical is the same graph flowing top to bottom, for narrow screens.
 */
export function getLayout(orientation: Orientation): DiagramLayout {
  if (orientation === 'horizontal') {
    const col = [80, 290, 500, 710, 920];
    return {
      orientation,
      width: 1000,
      height: 440,
      nodeW: 140,
      nodeH: NODE_H,
      pos: {
        clients: { x: col[0], y: 220 },
        cdn: { x: col[1], y: 220 },
        lb: { x: col[2], y: 220 },
        app: { x: col[3], y: 220 },
        cache: { x: col[4], y: 85 },
        dbPrimary: { x: col[4], y: 220 },
        dbReplica: { x: col[4], y: 355 },
      },
    };
  }
  const row = [60, 230, 400, 575, 770];
  return {
    orientation,
    width: 440,
    height: 840,
    nodeW: 136,
    nodeH: NODE_H,
    pos: {
      clients: { x: 220, y: row[0] },
      cdn: { x: 220, y: row[1] },
      lb: { x: 220, y: row[2] },
      app: { x: 220, y: row[3] },
      cache: { x: 75, y: row[4] },
      dbPrimary: { x: 220, y: row[4] },
      dbReplica: { x: 365, y: row[4] },
    },
  };
}

/** Curve from the outgoing side of `from` to the incoming side of `to`. */
export function edgeCurve(layout: DiagramLayout, from: DiagramNodeId, to: DiagramNodeId): Curve {
  const a = layout.pos[from];
  const b = layout.pos[to];
  if (layout.orientation === 'horizontal') {
    const start = { x: a.x + layout.nodeW / 2, y: a.y };
    const end = { x: b.x - layout.nodeW / 2, y: b.y };
    const mid = (start.x + end.x) / 2;
    return [start, { x: mid, y: start.y }, { x: mid, y: end.y }, end];
  }
  const start = { x: a.x, y: a.y + layout.nodeH / 2 };
  const end = { x: b.x, y: b.y - layout.nodeH / 2 };
  const mid = (start.y + end.y) / 2;
  return [start, { x: start.x, y: mid }, { x: end.x, y: mid }, end];
}

export function curvePath([p0, p1, p2, p3]: Curve): string {
  return `M${p0.x} ${p0.y} C${p1.x} ${p1.y} ${p2.x} ${p2.y} ${p3.x} ${p3.y}`;
}

export function pointOnCurve([p0, p1, p2, p3]: Curve, t: number): Point {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}
