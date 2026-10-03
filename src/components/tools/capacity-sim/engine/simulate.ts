import type {
  Flow,
  LoadUnit,
  NodeId,
  NodeResult,
  ResourceLimit,
  SimConfig,
  SimResult,
  SimWarning,
} from './model';
import { mmcWait } from './queueing';

/** Share of server RAM available to worker processes (the rest is kept by the OS). */
export const USABLE_RAM_RATIO = 0.9;
/** p99 service time as a multiple of the average (less spread than exponential). */
export const P99_SERVICE_FACTOR = 2;
/** Latency reported for requests stuck behind a saturated node. */
export const TIMEOUT_MS = 10_000;

const NODE_ORDER: NodeId[] = ['cdn', 'lb', 'app', 'cache', 'dbPrimary', 'dbReplica'];

/** Static description of a node: what limits it and how it queues. */
interface NodeSpec {
  id: NodeId;
  instances: number;
  unit: LoadUnit;
  /** Parallel slots for queueing (vCPUs; 1 for single-threaded nodes). */
  parallelism: number;
  baseLatencyMs: number;
  limits: Omit<ResourceLimit, 'utilization'>[];
  capacity: number;
}

/** Values derived from the config that several calculations share. */
interface Derived {
  appCount: number;
  /** RAM available to worker processes on each server, in MB. */
  usableMB: number;
  /** Worker processes that fit in RAM on each server. */
  workersFit: number;
  /** Worker processes actually running per server (configured, capped by RAM). */
  workers: number;
  cacheHit: number;
  cdnHit: number;
  replicas: number;
  /** Average time a request holds app-server memory, at low load. */
  inFlightMs: number;
}

/** RAM available to worker processes on one app server, in MB. */
export function usableRamMB(app: SimConfig['app']): number {
  return app.ramGB * 1024 * USABLE_RAM_RATIO;
}

/** How many worker processes fit in one app server's RAM. */
export function workersThatFit(app: SimConfig['app']): number {
  // A sync worker also holds its one request's memory; async workers share request memory
  const perWorkerMB = app.serverType === 'sync' ? app.workerMemMB + app.memMB : app.workerMemMB;
  return Math.floor(usableRamMB(app) / perWorkerMB);
}

function derive(cfg: SimConfig): Derived {
  const { traffic, db } = cfg;
  const cacheHit = cfg.cache.enabled ? cfg.cache.hitRatio : 0;
  const dbTimeMs = traffic.queriesPerRequest * db.queryMs;
  const readMs = (cfg.cache.enabled ? cfg.cache.latencyMs : 0) + (1 - cacheHit) * dbTimeMs;
  const { app } = cfg;
  const usableMB = usableRamMB(app);
  const workersFit = workersThatFit(app);
  return {
    usableMB,
    workersFit,
    // Workers beyond what fits in RAM would be killed for running out of memory
    workers: Math.min(Math.max(1, Math.round(app.workers)), workersFit),
    // Without a load balancer, clients can only reach one server
    appCount: cfg.lb.enabled ? Math.max(1, Math.round(cfg.app.count)) : 1,
    cacheHit,
    cdnHit: cfg.cdn.enabled ? cfg.cdn.hitRatio : 0,
    replicas: Math.max(0, Math.round(db.replicas)),
    inFlightMs:
      cfg.app.cpuMs + traffic.readRatio * readMs + (1 - traffic.readRatio) * dbTimeMs,
  };
}

function spec(
  id: NodeId,
  instances: number,
  unit: LoadUnit,
  parallelism: number,
  baseLatencyMs: number,
  limits: NodeSpec['limits'],
): NodeSpec {
  const capacity = limits.length ? Math.min(...limits.map((l) => l.capacity)) : Infinity;
  return { id, instances, unit, parallelism, baseLatencyMs, limits, capacity };
}

function buildSpecs(cfg: SimConfig, d: Derived): Partial<Record<NodeId, NodeSpec>> {
  const { app, db, traffic } = cfg;
  const specs: Partial<Record<NodeId, NodeSpec>> = {};

  if (cfg.cdn.enabled) {
    // Edges scale out on their own; treat them as unlimited
    specs.cdn = spec('cdn', 1, 'req', 1, cfg.cdn.latencyMs, []);
  }
  if (cfg.lb.enabled) {
    specs.lb = spec('lb', 1, 'req', 1, cfg.lb.latencyMs, [
      { resource: 'throughput', capacity: cfg.lb.maxRps, inputs: { maxRps: cfg.lb.maxRps } },
    ]);
  }

  const responseBytes = traffic.responseKB * 1000;
  const inFlightS = d.inFlightMs / 1000;
  // Each worker process runs on one core at a time, so cores beyond the worker count sit idle
  const cores = Math.min(d.workers, app.vcpu);
  const appLimits: NodeSpec['limits'] = [
    {
      resource: 'cpu',
      capacity: (cores * 1000) / app.cpuMs,
      inputs: { workers: d.workers, vcpu: app.vcpu, cpuMs: app.cpuMs },
    },
  ];
  if (app.serverType === 'async') {
    // The workers' base memory is paid once; what's left holds in-flight requests.
    // Little's law: throughput = requests in flight / time each is in flight
    const freeMB = Math.max(0, d.usableMB - d.workers * app.workerMemMB);
    const concurrency = freeMB / app.memMB;
    appLimits.push({
      resource: 'ram',
      capacity: concurrency / inFlightS,
      formula: 'ramAsync',
      inputs: {
        usableMB: d.usableMB,
        workers: d.workers,
        workerMemMB: app.workerMemMB,
        memMB: app.memMB,
        concurrency,
        inFlightMs: d.inFlightMs,
      },
    });
  } else {
    // One request per worker, so the workers that fit in RAM cap how many run at once
    appLimits.push(
      {
        resource: 'ram',
        capacity: d.workersFit / inFlightS,
        formula: 'ramSync',
        inputs: {
          usableMB: d.usableMB,
          workerMemMB: app.workerMemMB,
          memMB: app.memMB,
          fit: d.workersFit,
          inFlightMs: d.inFlightMs,
        },
      },
      {
        resource: 'workers',
        capacity: d.workers / inFlightS,
        inputs: { workers: d.workers, inFlightMs: d.inFlightMs },
      },
    );
  }
  appLimits.push({
    resource: 'network',
    capacity: (app.netGbps * 1e9) / 8 / responseBytes,
    inputs: { netGbps: app.netGbps, responseKB: traffic.responseKB },
  });
  // Queueing slots: busy cores for async; workers for sync, since each holds a request while it waits
  const slots = app.serverType === 'sync' ? d.workers : cores;
  specs.app = spec('app', d.appCount, 'req', Math.max(1, slots), app.cpuMs, appLimits);

  if (cfg.cache.enabled) {
    // Redis-style: one thread handles every operation
    specs.cache = spec('cache', 1, 'op', 1, cfg.cache.latencyMs, [
      { resource: 'ops', capacity: cfg.cache.maxOps, inputs: { maxOps: cfg.cache.maxOps } },
    ]);
  }

  // Every worker process keeps its own pool
  const connections = Math.min(db.maxConnections, d.appCount * d.workers * app.poolSize);
  const dbLimits: NodeSpec['limits'] = [
    {
      resource: 'cpu',
      capacity: (db.vcpu * 1000) / db.queryMs,
      inputs: { vcpu: db.vcpu, queryMs: db.queryMs },
    },
    {
      // Each connection runs one query at a time
      resource: 'connections',
      capacity: (connections * 1000) / db.queryMs,
      inputs: {
        maxConnections: db.maxConnections,
        servers: d.appCount,
        workers: d.workers,
        poolSize: app.poolSize,
        opened: d.appCount * d.workers * app.poolSize,
        queryMs: db.queryMs,
      },
    },
  ];
  specs.dbPrimary = spec('dbPrimary', 1, 'query', db.vcpu, db.queryMs, dbLimits);
  if (d.replicas > 0) {
    specs.dbReplica = spec('dbReplica', d.replicas, 'query', db.vcpu, db.queryMs, dbLimits);
  }

  return specs;
}

interface FlowPass {
  /** Total load arriving at each node (all instances). */
  offered: Partial<Record<NodeId, number>>;
  served: Partial<Record<NodeId, number>>;
  /** Requests per second that complete successfully. */
  success: number;
}

/**
 * Pushes `rps` through the architecture. With `bounded`, each node handles at
 * most its capacity and the excess fails; unbounded gives the pure demand on
 * each node, which grows linearly with traffic.
 */
function runFlow(
  cfg: SimConfig,
  d: Derived,
  specs: Partial<Record<NodeId, NodeSpec>>,
  rps: number,
  bounded: boolean,
): FlowPass {
  const offered: FlowPass['offered'] = {};
  const served: FlowPass['served'] = {};
  /** Records load at a node and returns the share it can handle. */
  const pass = (id: NodeId, load: number): number => {
    const s = specs[id]!;
    const handled = bounded ? Math.min(load, s.capacity * s.instances) : load;
    offered[id] = load;
    served[id] = handled;
    return load > 0 ? handled / load : 1;
  };

  const { readRatio, queriesPerRequest: qpr } = cfg.traffic;
  let edgeHits = 0;
  if (specs.cdn) {
    pass('cdn', rps);
    edgeHits = rps * d.cdnHit;
  }
  const toOrigin = rps - edgeHits;
  const atApp = specs.lb ? toOrigin * pass('lb', toOrigin) : toOrigin;
  const appServed = atApp * pass('app', atApp);

  const reads = appServed * readRatio;
  const writes = appServed * (1 - readRatio);
  const cacheOk = specs.cache ? pass('cache', reads) : 1;
  const readQueries = reads * cacheOk * (1 - d.cacheHit) * qpr;
  const writeQueries = writes * qpr;

  let readDbOk: number;
  let writeOk: number;
  if (specs.dbReplica) {
    // Reads spread across replicas; every replica also replays every write
    writeOk = pass('dbPrimary', writeQueries);
    readDbOk = pass('dbReplica', readQueries + writeQueries * d.replicas);
  } else {
    writeOk = readDbOk = pass('dbPrimary', readQueries + writeQueries);
  }

  const readSuccess = reads * cacheOk * (d.cacheHit + (1 - d.cacheHit) * readDbOk);
  return { offered, served, success: edgeHits + readSuccess + writes * writeOk };
}

function nodeLatency(s: NodeSpec, perInstance: number): { avg: number; p99: number } {
  if (s.capacity === Infinity) return { avg: s.baseLatencyMs, p99: s.baseLatencyMs };
  const wait = mmcWait(perInstance, s.capacity, s.parallelism);
  return {
    avg: Math.min(TIMEOUT_MS, s.baseLatencyMs + wait.avgMs),
    p99: Math.min(TIMEOUT_MS, s.baseLatencyMs * P99_SERVICE_FACTOR + wait.p99Ms),
  };
}

interface Path {
  share: number;
  avg: number;
  p99: number;
}

/** p99 across request paths: walk from the slowest path until 1% of traffic is covered. */
function overallP99(paths: Path[]): number {
  const sorted = paths.filter((p) => p.share > 0).sort((a, b) => b.p99 - a.p99);
  let covered = 0;
  for (const p of sorted) {
    covered += p.share;
    if (covered >= 0.01) return p.p99;
  }
  return sorted.at(-1)?.p99 ?? 0;
}

export function simulate(cfg: SimConfig): SimResult {
  const d = derive(cfg);
  const specs = buildSpecs(cfg, d);
  const rps = Math.max(0, cfg.traffic.rps);
  const actual = runFlow(cfg, d, specs, rps, true);
  // Demand per instance at 1 req/s; it scales linearly, so capacity ÷ demand = max rps
  const unit = runFlow(cfg, d, specs, 1, false);

  const nodes: SimResult['nodes'] = {};
  let maxRps = Infinity;
  let bottleneck: SimResult['bottleneck'] = null;
  const latency: Partial<Record<NodeId, { avg: number; p99: number }>> = {};

  for (const id of NODE_ORDER) {
    const s = specs[id];
    if (!s) continue;
    const offered = (actual.offered[id] ?? 0) / s.instances;
    const served = (actual.served[id] ?? 0) / s.instances;
    const limits = s.limits.map((l) => ({ ...l, utilization: offered / l.capacity }));
    const limiting = limits.length
      ? limits.reduce((a, b) => (b.capacity < a.capacity ? b : a))
      : null;
    const lat = nodeLatency(s, offered);
    latency[id] = lat;

    nodes[id] = {
      id,
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
    };

    const demand = (unit.offered[id] ?? 0) / s.instances;
    if (limiting && demand > 0 && s.capacity / demand < maxRps) {
      maxRps = s.capacity / demand;
      bottleneck = { node: id, resource: limiting.resource };
    }
  }

  // End-to-end latency, weighted over the paths a request can take
  const { readRatio, queriesPerRequest: qpr } = cfg.traffic;
  const zero = { avg: 0, p99: 0 };
  const lb = latency.lb ?? zero;
  const app = latency.app!;
  const cache = latency.cache ?? zero;
  /** qpr sequential queries: average each, but assume only one hits the tail. */
  const dbTime = (l: { avg: number; p99: number }) => ({
    avg: qpr * l.avg,
    p99: qpr * l.avg + (l.p99 - l.avg),
  });
  const readDb = dbTime(latency.dbReplica ?? latency.dbPrimary!);
  const writeDb = dbTime(latency.dbPrimary!);
  const origin = 1 - d.cdnHit;
  const front = { avg: lb.avg + app.avg, p99: lb.p99 + app.p99 };
  const sum = (...parts: { avg: number; p99: number }[]) => ({
    avg: Math.min(TIMEOUT_MS, parts.reduce((t, p) => t + p.avg, 0)),
    p99: Math.min(TIMEOUT_MS, parts.reduce((t, p) => t + p.p99, 0)),
  });
  const paths: Path[] = [
    { share: d.cdnHit, ...(latency.cdn ?? zero) },
    { share: origin * readRatio * d.cacheHit, ...sum(front, cache) },
    { share: origin * readRatio * (1 - d.cacheHit), ...sum(front, cache, readDb) },
    { share: origin * (1 - readRatio), ...sum(front, writeDb) },
  ];

  const flows: Flow[] = [];
  const addFlow = (from: Flow['from'], to: NodeId) => {
    const rate = actual.offered[to] ?? 0;
    const handled = actual.served[to] ?? 0;
    flows.push({ from, to, rate, dropShare: rate > 0 ? 1 - handled / rate : 0 });
  };
  const chain: Flow['from'][] = ['clients'];
  if (specs.cdn) chain.push('cdn');
  if (specs.lb) chain.push('lb');
  chain.push('app');
  for (let i = 1; i < chain.length; i++) addFlow(chain[i - 1], chain[i] as NodeId);
  if (specs.cache) addFlow('app', 'cache');
  addFlow('app', 'dbPrimary');
  if (specs.dbReplica) addFlow('app', 'dbReplica');

  const warnings: SimWarning[] = [];
  if (!cfg.lb.enabled && cfg.app.count > 1) {
    warnings.push({ code: 'lbRequired', count: cfg.app.count });
  }
  const configuredWorkers = Math.max(1, Math.round(cfg.app.workers));
  if (d.workers < configuredWorkers) {
    warnings.push({
      code: 'workersDontFit',
      workers: configuredWorkers,
      fit: d.workersFit,
      ramGB: cfg.app.ramGB,
    });
  }
  if (d.workers > 0 && d.workers < cfg.app.vcpu) {
    warnings.push({ code: 'idleCores', workers: d.workers, vcpu: cfg.app.vcpu });
  }
  const needed = d.appCount * d.workers * cfg.app.poolSize;
  if (needed > cfg.db.maxConnections) {
    warnings.push({
      code: 'connectionsExceeded',
      servers: d.appCount,
      workers: d.workers,
      pool: cfg.app.poolSize,
      needed,
      max: cfg.db.maxConnections,
    });
  }

  return {
    nodes,
    flows,
    maxRps,
    bottleneck,
    avgLatencyMs: paths.reduce((t, p) => t + p.share * p.avg, 0),
    p99LatencyMs: overallP99(paths),
    errorRate: rps > 0 ? Math.max(0, 1 - actual.success / rps) : 0,
    servedRps: actual.success,
    warnings,
  };
}
