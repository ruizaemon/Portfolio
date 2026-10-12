import type {
  LoadUnit,
  Resource,
  ResourceLimit,
  SimConfig,
} from '../../capacity-sim/engine/model';

export type { LoadUnit, Resource, ResourceLimit, SimConfig };

/**
 * Components of one region's stack, plus the pooler and the database tier.
 * Every region runs the same stack; the primaries live in the home region only.
 */
export type NodeKind = 'cdn' | 'lb' | 'app' | 'cache' | 'pooler' | 'replica' | 'primary';

/** A component in a region: `app@1` is the app tier of region 1 (zero-based). */
export type DistNodeId = `${NodeKind}@${number}`;

export function nodeId(kind: NodeKind, region: number): DistNodeId {
  return `${kind}@${region}`;
}

export function parseNodeId(id: DistNodeId): { kind: NodeKind; region: number } {
  const [kind, region] = id.split('@');
  return { kind: kind as NodeKind, region: Number(region) };
}

export interface DistConfig {
  /**
   * The stack every region runs, as configured in part 1. `traffic.rps` is the
   * global request rate; the load balancer is always on.
   */
  stack: SimConfig;
  regions: {
    count: number;
    /** Regions (zero-based) that are down; their traffic goes to the others. */
    down: number[];
    /** Round trip from any region to another. */
    crossRegionMs: number;
  };
  shards: {
    count: number;
    /** Share of all queries that go to the busiest shard (0–1); at least 1 / count. */
    hotShare: number;
  };
  pooler: {
    enabled: boolean;
    /** Server-side connections the pooler keeps open to each database. */
    poolSize: number;
  };
  retries: {
    /** Extra attempts a client makes after a failed request. */
    attempts: number;
    /** Cap retries at 10% of the original traffic. */
    budget: boolean;
  };
  shedding: {
    enabled: boolean;
    /** Share of a region's capacity it admits; the rest is rejected at once (0–1). */
    threshold: number;
  };
}

export interface DistNode {
  id: DistNodeId;
  kind: NodeKind;
  region: number;
  instances: number;
  unit: LoadUnit;
  /** Load arriving at each instance, per second. */
  offered: number;
  served: number;
  capacity: number;
  utilization: number;
  limits: ResourceLimit[];
  limitingResource: Resource | null;
  avgLatencyMs: number;
  p99LatencyMs: number;
  saturated: boolean;
  /** Database nodes show the hottest shard; this is the load per instance on each other shard. */
  restOffered?: number;
}

export type DistFlowKind = 'request' | 'read' | 'write' | 'readWrite';

export interface DistFlow {
  from: DistNodeId | `clients@${number}`;
  to: DistNodeId;
  kind: DistFlowKind;
  /** Load per second over this edge (all instances). */
  rate: number;
  reads?: number;
  writes?: number;
  /** Share of the load arriving at `to` that it can't handle (0–1). */
  dropShare: number;
  /** Leaves the region, so it pays the cross-region round trip. */
  crossRegion: boolean;
}

export interface RegionResult {
  index: number;
  live: boolean;
  home: boolean;
  /** Attempts per second routed here, retries included. */
  rps: number;
  /** Attempts rejected by load shedding, per second. */
  shed: number;
  /** Attempts that succeed, per second. */
  served: number;
  errorRate: number;
  avgLatencyMs: number;
  p99LatencyMs: number;
}

export type DistWarning =
  | { code: 'failover'; from: number; to: number }
  | {
      code: 'connectionsExceeded';
      regions: number;
      servers: number;
      workers: number;
      pool: number;
      needed: number;
      max: number;
    }
  | { code: 'hotShard'; share: number; even: number; shards: number }
  | { code: 'crossRegionReads'; regions: number }
  | { code: 'retries'; retries: number; extra: number }
  | { code: 'shedding'; shed: number };

export interface DistResult {
  /** Region hosting the primaries: region 0, or the first live one after a failover. */
  home: number;
  live: number[];
  regions: RegionResult[];
  nodes: Partial<Record<DistNodeId, DistNode>>;
  flows: DistFlow[];
  /** Highest request rate before any node saturates, with the current regions. */
  maxRps: number;
  bottleneck: { node: DistNodeId; resource: Resource } | null;
  /** Max sustainable if one more region went down; null with a single live region. */
  maxRpsAfterRegionLoss: number | null;
  avgLatencyMs: number;
  p99LatencyMs: number;
  /** Share of original requests that never succeed, retries included. */
  errorRate: number;
  servedRps: number;
  /** Total attempts per second: traffic plus retries. */
  attemptsRps: number;
  retryRps: number;
  shedRps: number;
  warnings: DistWarning[];
}
