/**
 * Erlang C: the probability that an arriving request has to queue, for an
 * M/M/c system with `c` parallel servers and offered load `a` = λ/μ (erlangs).
 * Uses the Erlang B recurrence, which stays numerically stable for large c.
 */
export function erlangC(c: number, a: number): number {
  if (a <= 0) return 0;
  if (a >= c) return 1;
  let b = 1;
  for (let k = 1; k <= c; k++) b = (a * b) / (k + a * b);
  const rho = a / c;
  return b / (1 - rho * (1 - b));
}

export interface QueueWait {
  avgMs: number;
  p99Ms: number;
}

/**
 * Queueing delay for arrival rate `lambda` (per second) at a node with `c`
 * parallel slots that together handle `capacity` per second.
 * Waiting time in M/M/c is 0 with probability 1 − C, otherwise exponential
 * with rate (cμ − λ), which gives closed forms for the mean and the p99.
 */
export function mmcWait(lambda: number, capacity: number, c: number): QueueWait {
  if (lambda <= 0) return { avgMs: 0, p99Ms: 0 };
  if (lambda >= capacity) return { avgMs: Infinity, p99Ms: Infinity };
  const slots = Math.max(1, Math.round(c));
  const pWait = erlangC(slots, lambda / (capacity / slots));
  const drainPerMs = (capacity - lambda) / 1000;
  return {
    avgMs: pWait / drainPerMs,
    p99Ms: pWait > 0.01 ? Math.log(pWait / 0.01) / drainPerMs : 0,
  };
}
