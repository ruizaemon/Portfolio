/** Components of the simulated architecture, in request order. */
export type NodeId = 'cdn' | 'lb' | 'app' | 'cache' | 'dbPrimary' | 'dbReplica';

/** A resource that can cap a component's throughput. */
export type Resource = 'cpu' | 'ram' | 'workers' | 'network' | 'throughput' | 'ops' | 'connections';

/**
 * How app servers run requests. `async`: each worker process juggles many
 * requests (Node.js, FastAPI with async code). `sync`: each worker handles one
 * request at a time (Gunicorn sync workers, PHP-FPM, Unicorn).
 */
export type ServerType = 'async' | 'sync';

/** What a component's load is counted in. */
export type LoadUnit = 'req' | 'query' | 'op';

export interface SimConfig {
  traffic: {
    rps: number;
    /** Share of requests that are reads (0–1); the rest are writes. */
    readRatio: number;
    responseKB: number;
    /** Database queries each request makes when it reaches the database. */
    queriesPerRequest: number;
  };
  cdn: {
    enabled: boolean;
    /** Share of all requests answered at the edge without reaching the origin (0–1). */
    hitRatio: number;
    latencyMs: number;
  };
  lb: {
    enabled: boolean;
    maxRps: number;
    latencyMs: number;
  };
  app: {
    count: number;
    serverType: ServerType;
    /** Worker processes per server; each runs on one core at a time. */
    workers: number;
    /** Base memory of one worker process (interpreter, framework, libraries). */
    workerMemMB: number;
    vcpu: number;
    ramGB: number;
    netGbps: number;
    /** CPU time spent per request. */
    cpuMs: number;
    /** Memory held by each in-flight request, on top of its worker's base. */
    memMB: number;
    /** Database connections each worker process keeps open. */
    poolSize: number;
  };
  cache: {
    enabled: boolean;
    /** Share of reads answered by the cache (0–1). */
    hitRatio: number;
    maxOps: number;
    latencyMs: number;
  };
  db: {
    vcpu: number;
    /** Time per query; assumed to be CPU-bound. */
    queryMs: number;
    maxConnections: number;
    /** Read replicas with the same spec as the primary. */
    replicas: number;
  };
}

export interface ResourceLimit {
  resource: Resource;
  /** Max load per instance this resource allows, in the node's unit per second. */
  capacity: number;
  /** offered / capacity for this resource. */
  utilization: number;
  /** Values that went into the capacity formula, for explanations. */
  inputs: Record<string, number>;
  /** Formula variant for explanations, when a resource can be worked out more than one way. */
  formula?: string;
}

export interface NodeResult {
  id: NodeId;
  instances: number;
  unit: LoadUnit;
  /** Load arriving at each instance, per second. */
  offered: number;
  /** Load each instance actually handles, per second. */
  served: number;
  /** Max load per instance (the tightest resource limit). */
  capacity: number;
  /** offered / capacity; above 1 means saturated. */
  utilization: number;
  limits: ResourceLimit[];
  limitingResource: Resource | null;
  /** Average time spent at this node per visit, including queueing. */
  avgLatencyMs: number;
  p99LatencyMs: number;
  saturated: boolean;
}

/** Traffic along one edge of the diagram (total across instances). */
export interface Flow {
  from: 'clients' | NodeId;
  to: NodeId;
  /** Load per second arriving at `to` over this edge. */
  rate: number;
  /** Share of that load `to` can't handle (0–1). */
  dropShare: number;
}

export type SimWarning =
  | { code: 'lbRequired'; count: number }
  | {
      code: 'connectionsExceeded';
      servers: number;
      workers: number;
      pool: number;
      needed: number;
      max: number;
    }
  | { code: 'idleCores'; workers: number; vcpu: number }
  | { code: 'workersDontFit'; workers: number; fit: number; ramGB: number };

export interface SimResult {
  nodes: Partial<Record<NodeId, NodeResult>>;
  flows: Flow[];
  /** Highest request rate before any node saturates. */
  maxRps: number;
  /** The first node to saturate as traffic grows. */
  bottleneck: { node: NodeId; resource: Resource } | null;
  avgLatencyMs: number;
  p99LatencyMs: number;
  errorRate: number;
  servedRps: number;
  warnings: SimWarning[];
}
