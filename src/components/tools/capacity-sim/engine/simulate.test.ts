import { describe, expect, it } from 'vitest';
import { erlangC, mmcWait } from './queueing';
import { simulate, TIMEOUT_MS } from './simulate';
import { presetConfig } from './presets';

describe('queueing', () => {
  it('matches M/M/1: P(wait) = ρ', () => {
    expect(erlangC(1, 0.5)).toBeCloseTo(0.5);
  });

  it('matches the textbook M/M/2 value', () => {
    // c = 2, a = 1 erlang → C = 1/3
    expect(erlangC(2, 1)).toBeCloseTo(1 / 3);
  });

  it('gives the M/M/1 mean wait ρ / (μ − λ)', () => {
    // λ = 50/s, μ = 100/s → 0.5 / 50 s = 10 ms
    expect(mmcWait(50, 100, 1).avgMs).toBeCloseTo(10);
  });

  it('never waits when idle and waits forever when saturated', () => {
    expect(mmcWait(0, 100, 4)).toEqual({ avgMs: 0, p99Ms: 0 });
    expect(mmcWait(100, 100, 4).avgMs).toBe(Infinity);
  });
});

describe('simulate', () => {
  it('finds the database as the bottleneck on a single VPS', () => {
    const r = simulate(presetConfig('oneVps'));
    // App CPU: 2 × 1000 / 10 = 200 req/s; DB CPU: 2 × 1000 / 4 = 500 queries/s ÷ 3 per request
    expect(r.nodes.app!.capacity).toBeCloseTo(200);
    expect(r.nodes.dbPrimary!.capacity).toBeCloseTo(500);
    expect(r.maxRps).toBeCloseTo(500 / 3);
    expect(r.bottleneck).toEqual({ node: 'dbPrimary', resource: 'cpu' });
    expect(r.errorRate).toBe(0);
  });

  it('moves the bottleneck to the app servers once a cache absorbs reads', () => {
    const r = simulate(presetConfig('addCache'));
    // DB queries per request: 0.9 reads × 15% misses × 3 + 0.1 writes × 3 = 0.705
    expect(r.nodes.dbPrimary!.offered).toBeCloseTo(180 * 0.705);
    expect(r.maxRps).toBeCloseTo(200);
    expect(r.bottleneck).toEqual({ node: 'app', resource: 'cpu' });
  });

  it('spreads reads over replicas but replays every write on each', () => {
    const r = simulate(presetConfig('readReplicas'));
    const reads = 900 * 0.9 * 0.15 * 3;
    const writes = 900 * 0.1 * 3;
    expect(r.nodes.dbPrimary!.offered).toBeCloseTo(writes);
    expect(r.nodes.dbReplica!.offered).toBeCloseTo(reads / 2 + writes);
    expect(r.nodes.dbReplica!.instances).toBe(2);
  });

  it('reports errors and timeouts past capacity', () => {
    const cfg = presetConfig('oneVps');
    cfg.traffic.rps = 1000;
    const r = simulate(cfg);
    expect(r.nodes.app!.saturated).toBe(true);
    // The app handles 200 of 1000 req/s, then the DB caps that at ~167
    expect(r.servedRps).toBeCloseTo(500 / 3);
    expect(r.errorRate).toBeCloseTo(1 - 500 / 3 / 1000);
    expect(r.p99LatencyMs).toBe(TIMEOUT_MS);
  });

  it('serves CDN hits without touching the origin', () => {
    const cfg = presetConfig('oneVps');
    cfg.cdn.enabled = true;
    cfg.cdn.hitRatio = 0.5;
    const r = simulate(cfg);
    expect(r.nodes.app!.offered).toBeCloseTo(50);
    expect(r.maxRps).toBeCloseTo((500 / 3) * 2);
  });

  it('uses a single server without a load balancer', () => {
    const cfg = presetConfig('oneVps');
    cfg.app.count = 4;
    const r = simulate(cfg);
    expect(r.nodes.app!.instances).toBe(1);
    expect(r.warnings).toContainEqual({ code: 'lbRequired', count: 4 });
  });

  it('caps database throughput at the usable connections', () => {
    const cfg = presetConfig('scaleOut');
    cfg.app.count = 10;
    cfg.app.poolSize = 20;
    cfg.db.queryMs = 50;
    const r = simulate(cfg);
    const conn = r.nodes.dbPrimary!.limits.find((l) => l.resource === 'connections')!;
    // Every worker has its own pool: min(100 max, 10 servers × 2 workers × 20) × 1000 / 50 ms
    expect(conn.capacity).toBeCloseTo(2000);
    expect(r.warnings).toContainEqual({
      code: 'connectionsExceeded',
      servers: 10,
      workers: 2,
      pool: 20,
      needed: 400,
      max: 100,
    });
  });

  it('limits an async server by the memory left after its workers', () => {
    const cfg = presetConfig('oneVps');
    cfg.app.ramGB = 1;
    cfg.app.memMB = 400;
    const r = simulate(cfg);
    const ram = r.nodes.app!.limits.find((l) => l.resource === 'ram')!;
    // (1024 MB × 90% − 2 workers × 100 MB) / 400 MB ≈ 1.8 in flight, each for 10 + 3 × 4 = 22 ms
    expect(ram.inputs.inFlightMs).toBeCloseTo(22);
    expect(ram.capacity).toBeCloseTo((1024 * 0.9 - 200) / 400 / 0.022);
    expect(r.bottleneck).toEqual({ node: 'app', resource: 'ram' });
  });

  it('only uses as many cores as there are workers', () => {
    const cfg = presetConfig('oneVps');
    cfg.app.vcpu = 8;
    const r = simulate(cfg);
    const cpu = r.nodes.app!.limits.find((l) => l.resource === 'cpu')!;
    // 2 workers can keep only 2 of the 8 cores busy: 2 × 1000 / 10 ms
    expect(cpu.capacity).toBeCloseTo(200);
    expect(r.warnings).toContainEqual({ code: 'idleCores', workers: 2, vcpu: 8 });
  });

  it('limits a sync server by how many workers it has', () => {
    const cfg = presetConfig('oneVps');
    cfg.app.serverType = 'sync';
    cfg.app.workers = 4;
    cfg.app.memMB = 10;
    const r = simulate(cfg);
    const workers = r.nodes.app!.limits.find((l) => l.resource === 'workers')!;
    // One request per worker, each busy 22 ms: 4 / 0.022 s
    expect(workers.capacity).toBeCloseTo(4 / 0.022);
    expect(r.nodes.app!.limitingResource).toBe('workers');
  });

  it('drops sync workers that do not fit in RAM', () => {
    const cfg = presetConfig('oneVps');
    cfg.app.serverType = 'sync';
    cfg.app.ramGB = 1;
    cfg.app.vcpu = 8; // enough cores that memory, not CPU, is the limit
    cfg.app.workers = 10;
    cfg.app.memMB = 50;
    const r = simulate(cfg);
    // 1024 MB × 90% / (100 + 50 MB) = 6 workers fit
    expect(r.warnings).toContainEqual({ code: 'workersDontFit', workers: 10, fit: 6, ramGB: 1 });
    expect(r.nodes.app!.limitingResource).toBe('ram');
    expect(r.nodes.app!.capacity).toBeCloseTo(6 / 0.022);
  });

  it('grows latency as load approaches capacity', () => {
    const cfg = presetConfig('oneVps');
    const latencies = [20, 80, 140, 160].map((rps) => {
      cfg.traffic.rps = rps;
      return simulate(cfg).avgLatencyMs;
    });
    for (let i = 1; i < latencies.length; i++) {
      expect(latencies[i]).toBeGreaterThan(latencies[i - 1]);
    }
  });
});
