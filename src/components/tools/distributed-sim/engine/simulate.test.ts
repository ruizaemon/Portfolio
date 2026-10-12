import { describe, expect, it } from 'vitest';
import { distPresetConfig } from './presets';
import { hotShardShare, liveRegions, RETRY_BUDGET, simulateDistributed, TIMEOUT_MS } from './simulate';

describe('regions', () => {
  it('keeps one region up even when every region is down', () => {
    expect(liveRegions({ count: 3, down: [0, 1, 2], crossRegionMs: 0 })).toEqual([0]);
    expect(liveRegions({ count: 3, down: [0], crossRegionMs: 0 })).toEqual([1, 2]);
    expect(liveRegions({ count: 2, down: [5], crossRegionMs: 0 })).toEqual([0, 1]);
  });

  it('runs one copy of the stack per region and adds up their capacity', () => {
    const one = simulateDistributed(distPresetConfig('oneRegion'));
    // 6 servers × 2 vCPU × 1000 / 10 ms = 1,200 req/s, limited by app CPU
    expect(one.maxRps).toBeCloseTo(1200);
    expect(one.bottleneck).toEqual({ node: 'app@0', resource: 'cpu' });
    expect(one.maxRpsAfterRegionLoss).toBeNull();

    const cfg = distPresetConfig('oneRegion');
    cfg.regions.count = 3;
    const three = simulateDistributed(cfg);
    // The app tiers could take 3,600, but every replica replays every region's writes:
    // per replica, (1/3 × 0.405 reads / 2) + 0.3 writes = 0.3675 queries per global req/s
    expect(three.maxRps).toBeCloseTo(1000 / 0.3675);
    expect(three.bottleneck).toEqual({ node: 'replica@0', resource: 'cpu' });
    expect(three.maxRpsAfterRegionLoss).toBeCloseTo(2400);
    expect(three.nodes['app@2']!.offered).toBeCloseTo(300 / 6);
  });

  it('sends a down region’s traffic to the others', () => {
    const r = simulateDistributed(distPresetConfig('regionLoss'));
    expect(r.live).toEqual([0, 1]);
    expect(r.regions[2]).toMatchObject({ index: 2, live: false, rps: 0 });
    // 2,700 req/s over 2 regions, each able to take 1,200
    expect(r.regions[0].rps).toBeCloseTo(1350);
    expect(r.nodes['app@1']!.saturated).toBe(true);
    expect(r.errorRate).toBeCloseTo(1 - 2400 / 2700);
    expect(r.p99LatencyMs).toBe(TIMEOUT_MS);
    expect(r.nodes['app@2']).toBeUndefined();
  });

  it('fails the primaries over to the next region when the home region is down', () => {
    const cfg = distPresetConfig('oneRegion');
    cfg.regions.count = 3;
    cfg.regions.down = [0];
    const r = simulateDistributed(cfg);
    expect(r.home).toBe(1);
    expect(r.nodes['primary@1']).toBeDefined();
    expect(r.nodes['primary@0']).toBeUndefined();
    expect(r.warnings).toContainEqual({ code: 'failover', from: 0, to: 1 });
  });

  it('charges the cross-region round trip on writes, and on reads without replicas', () => {
    const r = simulateDistributed(distPresetConfig('crossRegion'));
    const [home, remote] = r.regions;
    expect(home.home).toBe(true);
    // Every origin request makes 3 queries to the primary's region: 3 × 80 ms more
    const origin = 1 - 0.85 * 0.9; // reads answered by the cache never leave the region
    expect(remote.avgLatencyMs - home.avgLatencyMs).toBeCloseTo(origin * 3 * 80, 0);
    expect(r.warnings).toContainEqual({ code: 'crossRegionReads', regions: 3 });
    expect(r.flows.filter((f) => f.crossRegion)).toHaveLength(2);
  });
});

describe('shards', () => {
  it('never lets the hot shard take less than an even share', () => {
    expect(hotShardShare({ count: 4, hotShare: 0.1 })).toBeCloseTo(0.25);
    expect(hotShardShare({ count: 4, hotShare: 0.7 })).toBeCloseTo(0.7);
    expect(hotShardShare({ count: 1, hotShare: 0.3 })).toBe(1);
  });

  it('is limited by the hottest shard while the others sit idle', () => {
    const r = simulateDistributed(distPresetConfig('hotShard'));
    const replica = r.nodes['replica@0']!;
    // Queries per request on one replica: 0.9 reads × 15% misses × 3 + 0.1 × 3 replayed writes = 0.705
    expect(replica.offered).toBeCloseTo(2000 * 0.705 * 0.7);
    expect(replica.restOffered).toBeCloseTo(2000 * 0.705 * 0.1);
    expect(r.bottleneck).toEqual({ node: 'replica@0', resource: 'cpu' });
    expect(r.maxRps).toBeCloseTo(1000 / (0.705 * 0.7));
    expect(r.warnings).toContainEqual({ code: 'hotShard', share: 0.7, even: 0.25, shards: 4 });
  });
});

describe('pooler', () => {
  it('moves the connection limit from the databases to the pooler', () => {
    const cfg = distPresetConfig('oneRegion');
    const without = simulateDistributed(cfg);
    expect(without.nodes['pooler@0']).toBeUndefined();
    expect(without.nodes['primary@0']!.limits.map((l) => l.resource)).toEqual(['cpu', 'connections']);

    cfg.pooler.enabled = true;
    cfg.pooler.poolSize = 20;
    const withPooler = simulateDistributed(cfg);
    const pooler = withPooler.nodes['pooler@0']!;
    // 20 server connections, each busy 4 ms per query
    expect(pooler.capacity).toBeCloseTo(5000);
    expect(withPooler.nodes['primary@0']!.limits.map((l) => l.resource)).toEqual(['cpu']);
  });

  it('warns when the workers open more connections than the database allows', () => {
    const cfg = distPresetConfig('oneRegion');
    cfg.regions.count = 3;
    cfg.stack.app.count = 20;
    const r = simulateDistributed(cfg);
    // 3 regions × 20 servers × 2 workers × 8 per pool
    expect(r.warnings).toContainEqual({
      code: 'connectionsExceeded',
      regions: 3,
      servers: 20,
      workers: 2,
      pool: 8,
      needed: 960,
      max: 500,
    });
    cfg.pooler.enabled = true;
    expect(simulateDistributed(cfg).warnings.some((w) => w.code === 'connectionsExceeded')).toBe(false);
  });
});

describe('retries and shedding', () => {
  it('multiplies the load when failures are retried without a budget', () => {
    const r = simulateDistributed(distPresetConfig('retryStorm'));
    // Nearly twice the attempts, yet no more requests succeed than the app tier can take
    expect(r.attemptsRps).toBeGreaterThan(2400);
    expect(r.servedRps).toBeCloseTo(1200);
    expect(r.errorRate).toBeCloseTo(1 - 1200 / 1300);
    expect(r.nodes['app@0']!.utilization).toBeGreaterThan(2);
  });

  it('caps retries at the budget', () => {
    const cfg = distPresetConfig('retryStorm');
    cfg.retries.budget = true;
    const r = simulateDistributed(cfg);
    expect(r.retryRps).toBeCloseTo(RETRY_BUDGET * 1300);
  });

  it('keeps latency low by rejecting the excess at once', () => {
    const r = simulateDistributed(distPresetConfig('shedding'));
    // Admits 80% of the 1,200 req/s capacity; the rest is shed, so no node saturates
    expect(r.shedRps).toBeCloseTo(1430 - 960);
    expect(r.servedRps).toBeCloseTo(960);
    expect(r.nodes['app@0']!.utilization).toBeCloseTo(0.8);
    expect(r.avgLatencyMs).toBeLessThan(100);
    expect(r.errorRate).toBeCloseTo(1 - 960 / 1300);
  });
});
