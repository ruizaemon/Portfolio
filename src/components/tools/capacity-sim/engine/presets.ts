import type { SimConfig } from './model';

export type PresetId = 'oneVps' | 'addCache' | 'scaleOut' | 'readReplicas' | 'blackFriday';

const oneVps: SimConfig = {
  traffic: { rps: 100, readRatio: 0.9, responseKB: 40, queriesPerRequest: 3 },
  cdn: { enabled: false, hitRatio: 0.6, latencyMs: 15 },
  lb: { enabled: false, maxRps: 50_000, latencyMs: 0.5 },
  app: {
    count: 1,
    serverType: 'async',
    workers: 2,
    workerMemMB: 100,
    vcpu: 2,
    ramGB: 4,
    netGbps: 1,
    cpuMs: 10,
    memMB: 0.1,
    poolSize: 10,
  },
  cache: { enabled: false, hitRatio: 0.85, maxOps: 100_000, latencyMs: 0.5 },
  db: { vcpu: 2, queryMs: 4, maxConnections: 100, replicas: 0 },
};

type Patch = { [K in keyof SimConfig]?: Partial<SimConfig[K]> };

function extend(base: SimConfig, patch: Patch): SimConfig {
  const out = structuredClone(base);
  for (const key of Object.keys(patch) as (keyof SimConfig)[]) {
    Object.assign(out[key], patch[key]);
  }
  return out;
}

const addCache = extend(oneVps, { traffic: { rps: 180 }, cache: { enabled: true } });
const scaleOut = extend(addCache, {
  traffic: { rps: 600 },
  lb: { enabled: true },
  app: { count: 4 },
});
const readReplicas = extend(scaleOut, {
  traffic: { rps: 900 },
  app: { count: 6, poolSize: 8 },
  db: { replicas: 2 },
});
// A 5× spike on the replicas setup; solvable with a CDN, more servers and replicas
const blackFriday = extend(readReplicas, { traffic: { rps: 4500 } });

export const PRESETS: Record<PresetId, SimConfig> = {
  oneVps,
  addCache,
  scaleOut,
  readReplicas,
  blackFriday,
};

export const PRESET_IDS = Object.keys(PRESETS) as PresetId[];

export function presetConfig(id: PresetId): SimConfig {
  return structuredClone(PRESETS[id]);
}
