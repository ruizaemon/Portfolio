import { PRESETS as STACKS, type PresetId } from '../../capacity-sim/engine/presets';
import type { DistConfig, SimConfig } from './model';

/** A part 1 stack with the load balancer on, carrying over the given request rate. */
export function stackConfig(id: PresetId, rps: number): SimConfig {
  const stack = structuredClone(STACKS[id]);
  stack.lb.enabled = true;
  stack.traffic.rps = rps;
  return stack;
}

export type DistPresetId =
  | 'oneRegion'
  | 'regionLoss'
  | 'crossRegion'
  | 'hotShard'
  | 'retryStorm'
  | 'shedding';

/**
 * Part 1's read-replicas stack with a bigger database, so the app tier is the
 * limit: 6 servers × 200 req/s = 1,200 req/s per region.
 */
function baseStack(rps: number): SimConfig {
  const stack = stackConfig('readReplicas', rps);
  stack.db.vcpu = 4;
  stack.db.maxConnections = 500;
  return stack;
}

const oneRegion: DistConfig = {
  stack: baseStack(900),
  regions: { count: 1, down: [], crossRegionMs: 80 },
  shards: { count: 1, hotShare: 1 },
  pooler: { enabled: false, poolSize: 20 },
  retries: { attempts: 0, budget: true },
  shedding: { enabled: false, threshold: 0.8 },
};

type Patch = { [K in keyof DistConfig]?: Partial<DistConfig[K]> };

function extend(base: DistConfig, rps: number, patch: Patch): DistConfig {
  const out = structuredClone(base);
  out.stack.traffic.rps = rps;
  for (const key of Object.keys(patch) as (keyof DistConfig)[]) {
    Object.assign(out[key], patch[key]);
  }
  return out;
}

// Three regions share 2,700 req/s at 75% each; with one down, the other two are at 112%
const regionLoss = extend(oneRegion, 2700, { regions: { count: 3, down: [2] } });
// Three regions, but no replicas: every read crosses to the primary's region
const crossRegion = extend(oneRegion, 1800, { regions: { count: 3 } });
crossRegion.stack.db.replicas = 0;
crossRegion.stack.db.vcpu = 8;
// Four shards, but 70% of the queries land on one of them
const hotShard = extend(oneRegion, 2000, { shards: { count: 4, hotShare: 0.7 } });
hotShard.stack.app.count = 12;
hotShard.stack.db.replicas = 1;
// 8% over capacity, and clients retry every failure 3 times with no budget
const retryStorm = extend(oneRegion, 1300, { retries: { attempts: 3, budget: false } });
// The same overload, with retries on a budget and the excess rejected at once
const shedding = extend(retryStorm, 1300, {
  retries: { budget: true },
  shedding: { enabled: true },
});

export const DIST_PRESETS: Record<DistPresetId, DistConfig> = {
  oneRegion,
  regionLoss,
  crossRegion,
  hotShard,
  retryStorm,
  shedding,
};

export const DIST_PRESET_IDS = Object.keys(DIST_PRESETS) as DistPresetId[];

export function distPresetConfig(id: DistPresetId): DistConfig {
  return structuredClone(DIST_PRESETS[id]);
}
