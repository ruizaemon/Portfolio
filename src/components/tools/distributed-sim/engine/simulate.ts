import type { ResourceLimit } from '../../capacity-sim/engine/model';
import { mmcWait } from '../../capacity-sim/engine/queueing';
import {
  buildSpecs,
  derive,
  P99_SERVICE_FACTOR,
  TIMEOUT_MS,
  type Derived,
} from '../../capacity-sim/engine/simulate';
import {
  nodeId,
  parseNodeId,
  type DistConfig,
  type DistFlow,
  type DistNode,
  type DistNodeId,
  type DistResult,
  type DistWarning,
  type LoadUnit,
  type NodeKind,
  type RegionResult,
  type SimConfig,
} from './model';

export { TIMEOUT_MS };

/** With a retry budget, clients send at most this share of the original traffic as retries. */
export const RETRY_BUDGET = 0.1;
/** Time a query spends passing through the pooler, on top of any wait for a connection. */
export const POOLER_LATENCY_MS = 0.2;

/** What one instance of a component can do, and how it queues. */
interface Spec {
  kind: NodeKind;
  instances: number;
  unit: LoadUnit;
  parallelism: number;
  baseLatencyMs: number;
  limits: Omit<ResourceLimit, 'utilization'>[];
  capacity: number;
}

/** The regions and specs a run works with; every live region runs the same stack. */
interface Topology {
  cfg: DistConfig;
  stack: SimConfig;
  d: Derived;
  live: number[];
  home: number;
  /** Share of all queries on the hottest shard, and on each of the others. */
  hot: number;
  rest: number;
  specs: Partial<Record<NodeKind, Spec>>;
}

function spec(
  kind: NodeKind,
  instances: number,
  unit: LoadUnit,
  parallelism: number,
  baseLatencyMs: number,
  limits: Spec['limits'],
): Spec {
  const capacity = limits.length ? Math.min(...limits.map((l) => l.capacity)) : Infinity;
  return { kind, instances, unit, parallelism, baseLatencyMs, limits, capacity };
}

/** Regions that are up, given how many exist and which are down. */
export function liveRegions(regions: DistConfig['regions'], extraDown: number[] = []): number[] {
  const count = Math.max(1, Math.round(regions.count));
  const down = new Set([...regions.down, ...extraDown]);
  const live = Array.from({ length: count }, (_, i) => i).filter((i) => !down.has(i));
  // Something has to serve traffic; with every region down, keep the first one up
  return live.length ? live : [0];
}

/** Share of queries on the hottest shard; never below an even split. */
export function hotShardShare(shards: DistConfig['shards']): number {
  const count = Math.max(1, Math.round(shards.count));
  return Math.min(1, Math.max(1 / count, shards.hotShare));
}

function topology(cfg: DistConfig, extraDown: number[] = []): Topology {
  // Several servers per region need a load balancer, so part 1's toggle is always on here
  const stack: SimConfig = { ...cfg.stack, lb: { ...cfg.stack.lb, enabled: true } };
  const d = derive(stack);
  const base = buildSpecs(stack, d);
  const live = liveRegions(cfg.regions, extraDown);
  // The primaries live in region 0; if it's down, they fail over to the next live region
  const home = live[0];
  const shards = Math.max(1, Math.round(cfg.shards.count));
  const hot = hotShardShare(cfg.shards);
  const rest = shards > 1 ? (1 - hot) / (shards - 1) : 0;

  const specs: Topology['specs'] = {};
  const copy = (kind: NodeKind, from: (typeof base)[keyof typeof base]) => {
    if (!from) return;
    specs[kind] = spec(kind, from.instances, from.unit, from.parallelism, from.baseLatencyMs, from.limits);
  };
  copy('cdn', base.cdn);
  copy('lb', base.lb);
  copy('app', base.app);
  copy('cache', base.cache);

  const { db, app } = stack;
  const cpu: Spec['limits'][number] = {
    resource: 'cpu',
    capacity: (db.vcpu * 1000) / db.queryMs,
    inputs: { vcpu: db.vcpu, queryMs: db.queryMs },
  };
  /** Connection limit of a database that `regions` regions' workers connect to directly. */
  const connections = (regions: number): Spec['limits'][number] => {
    const opened = regions * d.appCount * d.workers * app.poolSize;
    const usable = Math.min(db.maxConnections, opened);
    return {
      resource: 'connections',
      capacity: (usable * 1000) / db.queryMs,
      inputs: {
        maxConnections: db.maxConnections,
        regions,
        servers: d.appCount,
        workers: d.workers,
        poolSize: app.poolSize,
        opened,
        queryMs: db.queryMs,
      },
    };
  };
  if (cfg.pooler.enabled) {
    // The pooler holds the server-side connections; each is busy for one query at a time
    const poolSize = Math.max(1, Math.round(cfg.pooler.poolSize));
    const usable = Math.min(poolSize, db.maxConnections);
    specs.pooler = spec('pooler', 1, 'query', usable, POOLER_LATENCY_MS, [
      {
        resource: 'connections',
        capacity: (usable * 1000) / db.queryMs,
        inputs: { poolSize, maxConnections: db.maxConnections, queryMs: db.queryMs },
      },
    ]);
  }
  const replicas = Math.max(0, Math.round(db.replicas));
  if (replicas > 0) {
    // Only the region's own servers connect to its replicas
    const limits = cfg.pooler.enabled ? [cpu] : [cpu, connections(1)];
    specs.replica = spec('replica', replicas, 'query', db.vcpu, db.queryMs, limits);
  }
  // Every region's servers connect to the primaries
  const primaryLimits = cfg.pooler.enabled ? [cpu] : [cpu, connections(live.length)];
  specs.primary = spec('primary', 1, 'query', db.vcpu, db.queryMs, primaryLimits);

  return { cfg, stack, d, live, home, hot, rest, specs };
}

interface RegionPass {
  index: number;
  /** Attempts per second routed to this region. */
  rps: number;
  hits: number;
  /** Attempts for the origin, before and after load shedding. */
  toOrigin: number;
  origin: number;
  shed: number;
  atApp: number;
  reads: number;
  writes: number;
  readQueries: number;
  writeQueries: number;
  cacheOk: number;
  readOk: number;
  writeOk: number;
  success: number;
}

interface Pass {
  /** Total load arriving at each node (all instances), and what it handles. */
  offered: Map<DistNodeId, number>;
  served: Map<DistNodeId, number>;
  regions: RegionPass[];
  success: number;
  shed: number;
}

/**
 * Pushes `attempts` req/s through the regions. With `bounded`, each node handles
 * at most its capacity and the excess fails; unbounded gives the pure demand on
 * each node, which grows linearly with traffic. `shedCap` is the origin traffic
 * each region admits before rejecting the rest.
 */
function run(top: Topology, attempts: number, bounded: boolean, shedCap: number | null): Pass {
  const { specs, live, home, hot, stack } = top;
  const offered = new Map<DistNodeId, number>();
  const served = new Map<DistNodeId, number>();
  /** Records load at a node and returns the share it can handle. */
  const pass = (id: DistNodeId, s: Spec, load: number): number => {
    const handled = bounded ? Math.min(load, s.capacity * s.instances) : load;
    offered.set(id, load);
    served.set(id, handled);
    return load > 0 ? handled / load : 1;
  };

  const { readRatio, queriesPerRequest: qpr } = stack.traffic;
  const cdnHit = specs.cdn ? stack.cdn.hitRatio : 0;
  const cacheHit = specs.cache ? stack.cache.hitRatio : 0;
  const perRegion = attempts / live.length;

  const regions: RegionPass[] = live.map((i) => {
    const rps = perRegion;
    const hits = rps * cdnHit;
    if (specs.cdn) pass(nodeId('cdn', i), specs.cdn, rps);
    const toOrigin = rps - hits;
    const shed = shedCap === null ? 0 : Math.max(0, toOrigin - shedCap);
    const origin = toOrigin - shed;
    const atApp = origin * pass(nodeId('lb', i), specs.lb!, origin);
    const appServed = atApp * pass(nodeId('app', i), specs.app!, atApp);
    const reads = appServed * readRatio;
    const writes = appServed * (1 - readRatio);
    const cacheOk = specs.cache ? pass(nodeId('cache', i), specs.cache, reads) : 1;
    return {
      index: i,
      rps,
      hits,
      toOrigin,
      origin,
      shed,
      atApp,
      reads,
      writes,
      readQueries: reads * cacheOk * (1 - cacheHit) * qpr,
      writeQueries: writes * qpr,
      cacheOk,
      readOk: 1,
      writeOk: 1,
      success: 0,
    };
  });

  // The hot shard: writes from everywhere land on its primary and are replayed by
  // every one of its replicas; reads stay in their region when there are replicas
  const hotWrites = regions.reduce((t, r) => t + hot * r.writeQueries, 0);
  const hotReads = regions.reduce((t, r) => t + hot * r.readQueries, 0);
  const replicas = specs.replica;
  const primaryOk = pass(
    nodeId('primary', home),
    specs.primary!,
    hotWrites + (replicas ? 0 : hotReads),
  );

  for (const r of regions) {
    const hotR = hot * r.readQueries;
    const hotW = hot * r.writeQueries;
    let readOk = primaryOk;
    if (replicas) {
      readOk = pass(nodeId('replica', r.index), replicas, hotR + replicas.instances * hotWrites);
    }
    let poolReadOk = 1;
    let poolWriteOk = 1;
    if (specs.pooler) {
      // One pool per database: the busiest of the hot primary's and a hot replica's
      const toPrimary = hotW + (replicas ? 0 : hotR);
      const toReplica = replicas ? hotR / replicas.instances : 0;
      const cap = specs.pooler.capacity;
      const ok = (load: number) => (bounded && load > cap ? cap / load : 1);
      pass(nodeId('pooler', r.index), specs.pooler, Math.max(toPrimary, toReplica));
      poolWriteOk = ok(toPrimary);
      poolReadOk = replicas ? ok(toReplica) : poolWriteOk;
    }
    r.readOk = readOk * poolReadOk;
    r.writeOk = primaryOk * poolWriteOk;
    r.success =
      r.hits +
      r.reads * r.cacheOk * (cacheHit + (1 - cacheHit) * r.readOk) +
      r.writes * r.writeOk;
  }

  return {
    offered,
    served,
    regions,
    success: regions.reduce((t, r) => t + r.success, 0),
    shed: regions.reduce((t, r) => t + r.shed, 0),
  };
}

/** Every node of the topology with its spec, in diagram order. */
function allNodes(top: Topology): { id: DistNodeId; spec: Spec }[] {
  const out: { id: DistNodeId; spec: Spec }[] = [];
  const kinds: NodeKind[] = ['cdn', 'lb', 'app', 'cache', 'pooler', 'replica'];
  for (const i of top.live) {
    for (const kind of kinds) {
      const s = top.specs[kind];
      if (s) out.push({ id: nodeId(kind, i), spec: s });
    }
  }
  out.push({ id: nodeId('primary', top.home), spec: top.specs.primary! });
  return out;
}

/** Max request rate before any node saturates, from the demand at 1 req/s. */
function capacityOf(top: Topology): { maxRps: number; bottleneck: DistResult['bottleneck'] } {
  const unit = run(top, 1, false, null);
  let maxRps = Infinity;
  let bottleneck: DistResult['bottleneck'] = null;
  for (const { id, spec: s } of allNodes(top)) {
    const demand = (unit.offered.get(id) ?? 0) / s.instances;
    if (!s.limits.length || demand <= 0) continue;
    const limiting = s.limits.reduce((a, b) => (b.capacity < a.capacity ? b : a));
    if (s.capacity / demand < maxRps) {
      maxRps = s.capacity / demand;
      bottleneck = { node: id, resource: limiting.resource };
    }
  }
  return { maxRps, bottleneck };
}

interface Lat {
  avg: number;
  p99: number;
}

function latencyOf(s: Spec, perInstance: number): Lat {
  if (s.capacity === Infinity) return { avg: s.baseLatencyMs, p99: s.baseLatencyMs };
  const wait = mmcWait(perInstance, s.capacity, s.parallelism);
  return {
    avg: Math.min(TIMEOUT_MS, s.baseLatencyMs + wait.avgMs),
    p99: Math.min(TIMEOUT_MS, s.baseLatencyMs * P99_SERVICE_FACTOR + wait.p99Ms),
  };
}

interface Path extends Lat {
  share: number;
}

const ZERO: Lat = { avg: 0, p99: 0 };

function sum(...parts: Lat[]): Lat {
  return {
    avg: Math.min(TIMEOUT_MS, parts.reduce((t, p) => t + p.avg, 0)),
    p99: Math.min(TIMEOUT_MS, parts.reduce((t, p) => t + p.p99, 0)),
  };
}

/** p99 across request paths: walk from the slowest path until 1% of traffic is covered. */
function overallP99(paths: Path[]): number {
  const sorted = paths.filter((p) => p.share > 0).sort((a, b) => b.p99 - a.p99);
  const total = sorted.reduce((t, p) => t + p.share, 0);
  let covered = 0;
  for (const p of sorted) {
    covered += p.share;
    if (covered >= 0.01 * total) return p.p99;
  }
  return sorted.at(-1)?.p99 ?? 0;
}

function average(paths: Path[]): number {
  const total = paths.reduce((t, p) => t + p.share, 0);
  return total > 0 ? paths.reduce((t, p) => t + p.share * p.avg, 0) / total : 0;
}

export function simulateDistributed(cfg: DistConfig): DistResult {
  const top = topology(cfg);
  const { specs, live, home, stack, hot, rest } = top;
  const { maxRps, bottleneck } = capacityOf(top);
  const afterLoss =
    live.length > 1 ? capacityOf(topology(cfg, [live[live.length - 1]])).maxRps : null;

  const rps = Math.max(0, stack.traffic.rps);
  const cdnHit = specs.cdn ? stack.cdn.hitRatio : 0;
  const cacheHit = specs.cache ? stack.cache.hitRatio : 0;
  // Shedding admits a share of each region's fair share of capacity, counted at the origin
  const shedCap = cfg.shedding.enabled
    ? (cfg.shedding.threshold * maxRps * (1 - cdnHit)) / live.length
    : null;

  // Retries: failed attempts come back, so the attempt rate depends on the failure
  // share, which depends on the attempt rate. Iterate to the fixed point.
  const attemptsAfter = Math.max(0, Math.round(cfg.retries.attempts));
  let attempts = rps;
  let pass = run(top, attempts, true, shedCap);
  for (let i = 0; i < 60 && rps > 0; i++) {
    const fail = Math.max(0, 1 - pass.success / attempts);
    let series = 0;
    for (let k = 1; k <= attemptsAfter; k++) series += fail ** k;
    const wanted = rps * series;
    const retries = cfg.retries.budget ? Math.min(wanted, RETRY_BUDGET * rps) : wanted;
    const next = rps + retries;
    if (Math.abs(next - attempts) < 1e-6 * rps) break;
    attempts = (attempts + next) / 2;
    pass = run(top, attempts, true, shedCap);
  }

  const nodes: DistResult['nodes'] = {};
  const latency = new Map<DistNodeId, Lat>();
  for (const { id, spec: s } of allNodes(top)) {
    const offered = (pass.offered.get(id) ?? 0) / s.instances;
    const served = (pass.served.get(id) ?? 0) / s.instances;
    const limits = s.limits.map((l) => ({ ...l, utilization: offered / l.capacity }));
    const limiting = limits.length
      ? limits.reduce((a, b) => (b.capacity < a.capacity ? b : a))
      : null;
    const lat = latencyOf(s, offered);
    latency.set(id, lat);
    const { kind, region } = parseNodeId(id);
    nodes[id] = {
      id,
      kind,
      region,
      instances: s.instances,
      unit: s.unit,
      offered,
      served,
      capacity: s.capacity,
      utilization: s.capacity === Infinity ? 0 : offered / s.capacity,
      limits,
      limitingResource: limiting?.resource ?? null,
      avgLatencyMs: lat.avg,
      p99LatencyMs: lat.p99,
      saturated: offered > s.capacity,
      // Load on the other shards scales with their share of the queries
      ...(kind === 'replica' || kind === 'primary'
        ? { restOffered: hot > 0 ? offered * (rest / hot) : 0 }
        : {}),
    };
  }

  // Latency per region, weighted over the paths a request can take
  const { readRatio, queriesPerRequest: qpr } = stack.traffic;
  const cross = { avg: cfg.regions.crossRegionMs, p99: cfg.regions.crossRegionMs };
  /** qpr sequential queries: average each, but assume only one hits the tail. */
  const dbTime = (l: Lat): Lat => ({ avg: qpr * l.avg, p99: qpr * l.avg + (l.p99 - l.avg) });
  const primaryLat = latency.get(nodeId('primary', home))!;
  const allPaths: Path[] = [];
  const regions: RegionResult[] = [];
  const lat = (id: DistNodeId) => latency.get(id) ?? ZERO;

  for (const r of pass.regions) {
    const i = r.index;
    const remote = i === home ? ZERO : cross;
    const front = sum(lat(nodeId('lb', i)), lat(nodeId('app', i)));
    const pooler = specs.pooler ? lat(nodeId('pooler', i)) : ZERO;
    const cache = specs.cache ? lat(nodeId('cache', i)) : ZERO;
    // Reads go to the local replicas, or across to the primary when there are none
    const readDb = dbTime(specs.replica ? lat(nodeId('replica', i)) : sum(primaryLat, remote));
    const writeDb = dbTime(sum(primaryLat, remote));
    // Shares of the region's attempts; shed ones are rejected at once and not timed
    const originShare = r.rps > 0 ? r.origin / r.rps : 0;
    const paths: Path[] = [
      { share: r.rps > 0 ? r.hits / r.rps : 0, ...(specs.cdn ? lat(nodeId('cdn', i)) : ZERO) },
      { share: originShare * readRatio * cacheHit, ...sum(front, cache) },
      {
        share: originShare * readRatio * (1 - cacheHit),
        ...sum(front, cache, pooler, readDb),
      },
      { share: originShare * (1 - readRatio), ...sum(front, pooler, writeDb) },
    ];
    for (const p of paths) allPaths.push({ ...p, share: p.share * r.rps });
    regions.push({
      index: i,
      live: true,
      home: i === home,
      rps: r.rps,
      shed: r.shed,
      served: r.success,
      errorRate: r.rps > 0 ? Math.max(0, 1 - r.success / r.rps) : 0,
      avgLatencyMs: average(paths),
      p99LatencyMs: overallP99(paths),
    });
  }
  const count = Math.max(1, Math.round(cfg.regions.count));
  for (let i = 0; i < count; i++) {
    if (live.includes(i)) continue;
    regions.push({
      index: i,
      live: false,
      home: false,
      rps: 0,
      shed: 0,
      served: 0,
      errorRate: 0,
      avgLatencyMs: 0,
      p99LatencyMs: 0,
    });
  }
  regions.sort((a, b) => a.index - b.index);

  const flows: DistFlow[] = [];
  const dropAt = (id: DistNodeId, arriving: number) => {
    const handled = pass.served.get(id) ?? 0;
    return arriving > 0 ? Math.max(0, 1 - handled / arriving) : 0;
  };
  for (const r of pass.regions) {
    const i = r.index;
    const lbId = nodeId('lb', i);
    const appId = nodeId('app', i);
    if (specs.cdn) {
      const cdnId = nodeId('cdn', i);
      flows.push({ from: `clients@${i}`, to: cdnId, kind: 'request', rate: r.rps, dropShare: 0, crossRegion: false });
      flows.push({ from: cdnId, to: lbId, kind: 'request', rate: r.toOrigin, dropShare: dropAt(lbId, r.toOrigin), crossRegion: false });
    } else {
      flows.push({ from: `clients@${i}`, to: lbId, kind: 'request', rate: r.toOrigin, dropShare: dropAt(lbId, r.toOrigin), crossRegion: false });
    }
    flows.push({ from: lbId, to: appId, kind: 'request', rate: r.atApp, dropShare: dropAt(appId, r.atApp), crossRegion: false });
    if (specs.cache) {
      const cacheId = nodeId('cache', i);
      flows.push({ from: appId, to: cacheId, kind: 'read', rate: r.reads, dropShare: dropAt(cacheId, r.reads), crossRegion: false });
    }
    let dbSource: DistNodeId = appId;
    if (specs.pooler) {
      const poolId = nodeId('pooler', i);
      const total = r.readQueries + r.writeQueries;
      flows.push({
        from: appId,
        to: poolId,
        kind: 'readWrite',
        rate: total,
        reads: r.readQueries,
        writes: r.writeQueries,
        dropShare: dropAt(poolId, pass.offered.get(poolId) ?? 0),
        crossRegion: false,
      });
      dbSource = poolId;
    }
    const primaryId = nodeId('primary', home);
    if (specs.replica) {
      const replicaId = nodeId('replica', i);
      flows.push({
        from: dbSource,
        to: replicaId,
        kind: 'read',
        rate: r.readQueries,
        dropShare: dropAt(replicaId, pass.offered.get(replicaId) ?? 0),
        crossRegion: false,
      });
      flows.push({
        from: dbSource,
        to: primaryId,
        kind: 'write',
        rate: r.writeQueries,
        dropShare: dropAt(primaryId, pass.offered.get(primaryId) ?? 0),
        crossRegion: i !== home,
      });
    } else {
      flows.push({
        from: dbSource,
        to: primaryId,
        kind: 'readWrite',
        rate: r.readQueries + r.writeQueries,
        reads: r.readQueries,
        writes: r.writeQueries,
        dropShare: dropAt(primaryId, pass.offered.get(primaryId) ?? 0),
        crossRegion: i !== home,
      });
    }
  }

  const fail = attempts > 0 ? Math.max(0, 1 - pass.success / attempts) : 0;
  const servedRps = Math.min(rps, attempts * (1 - fail));
  const retryRps = attempts - rps;

  const warnings: DistWarning[] = [];
  if (home !== 0) warnings.push({ code: 'failover', from: 0, to: home });
  if (!cfg.pooler.enabled) {
    const needed = live.length * top.d.appCount * top.d.workers * stack.app.poolSize;
    if (needed > stack.db.maxConnections) {
      warnings.push({
        code: 'connectionsExceeded',
        regions: live.length,
        servers: top.d.appCount,
        workers: top.d.workers,
        pool: stack.app.poolSize,
        needed,
        max: stack.db.maxConnections,
      });
    }
  }
  const shards = Math.max(1, Math.round(cfg.shards.count));
  if (shards > 1 && hot > 1 / shards + 1e-9) {
    warnings.push({ code: 'hotShard', share: hot, even: 1 / shards, shards });
  }
  if (!specs.replica && live.length > 1) {
    warnings.push({ code: 'crossRegionReads', regions: live.length });
  }
  if (rps > 0 && retryRps > 0.005 * rps) {
    warnings.push({ code: 'retries', retries: retryRps, extra: retryRps / rps });
  }
  if (pass.shed > 0) warnings.push({ code: 'shedding', shed: pass.shed });

  return {
    home,
    live,
    regions,
    nodes,
    flows,
    maxRps,
    bottleneck,
    maxRpsAfterRegionLoss: afterLoss,
    avgLatencyMs: average(allPaths),
    p99LatencyMs: overallP99(allPaths),
    errorRate: rps > 0 ? Math.max(0, 1 - servedRps / rps) : 0,
    servedRps,
    attemptsRps: attempts,
    retryRps,
    shedRps: pass.shed,
    warnings,
  };
}
