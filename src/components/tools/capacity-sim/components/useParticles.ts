import { onBeforeUnmount, onMounted, type Ref } from 'vue';
import { pointOnCurve, type Curve } from './layout';

export type ParticleKind = 'request' | 'cache' | 'db';

export interface ParticleEdge {
  id: string;
  curve: Curve;
  /** Real load per second on this edge. */
  rate: number;
  /** Share of arrivals the target drops (0–1). */
  dropShare: number;
  kind: ParticleKind;
}

interface Particle {
  edgeId: string;
  t: number;
  speed: number;
  drop: boolean;
  /** 0–1 progress of the "dropped" puff once a failed particle arrives. */
  fade: number;
}

const TRAVEL_S = 1.4;
const FADE_S = 0.5;
const MAX_PARTICLES = 800;
const RADIUS = 3.2;

/**
 * Dots per second drawn for a real rate. Logarithmic, so 10 req/s and
 * 100,000 req/s both stay readable: ~4/s at 10, ~16/s at 100,000.
 */
export function visualRate(rate: number): number {
  return rate > 0 ? 1 + 3 * Math.log10(1 + rate) : 0;
}

/**
 * Animates dots along the diagram's edges on a canvas laid over the SVG.
 * Coordinates are in viewBox units; `viewWidth` maps them to pixels.
 * Stays idle under prefers-reduced-motion and while scrolled out of view.
 */
export function useParticles(
  canvas: Ref<HTMLCanvasElement | null>,
  edges: Ref<ParticleEdge[]>,
  viewWidth: Ref<number>,
) {
  let particles: Particle[] = [];
  const spawnDebt = new Map<string, number>();
  let frame = 0;
  let last = 0;
  let visible = true;
  let colors: Record<ParticleKind | 'drop', string> | null = null;
  let colorAge = 0;
  let resizeObserver: ResizeObserver | undefined;
  let intersectionObserver: IntersectionObserver | undefined;
  const motionQuery =
    typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  function readColors(el: HTMLElement) {
    const style = getComputedStyle(el);
    const v = (name: string) => style.getPropertyValue(name).trim();
    colors = {
      request: v('--color-primary'),
      cache: v('--color-secondary'),
      db: v('--color-accent'),
      drop: v('--color-pink'),
    };
  }

  function fitCanvas() {
    const el = canvas.value;
    if (!el) return;
    const dpr = window.devicePixelRatio || 1;
    el.width = Math.round(el.clientWidth * dpr);
    el.height = Math.round(el.clientHeight * dpr);
  }

  function step(now: number) {
    frame = 0;
    const el = canvas.value;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    // Cap the step so a background-tab pause doesn't dump a burst of dots
    const dt = last ? Math.min((now - last) / 1000, 0.05) : 0;
    last = now;

    // Theme can change at any time; re-read colors a few times a second
    colorAge -= dt;
    if (!colors || colorAge <= 0) {
      readColors(el);
      colorAge = 0.5;
    }

    const byId = new Map(edges.value.map((e) => [e.id, e]));
    for (const edge of byId.values()) {
      let debt = (spawnDebt.get(edge.id) ?? 0) + visualRate(edge.rate) * dt;
      while (debt >= 1 && particles.length < MAX_PARTICLES) {
        debt -= 1;
        particles.push({
          edgeId: edge.id,
          t: 0,
          speed: 0.85 + Math.random() * 0.3,
          drop: Math.random() < edge.dropShare,
          fade: 0,
        });
      }
      spawnDebt.set(edge.id, Math.min(debt, 1));
    }

    particles = particles.filter((p) => {
      if (!byId.has(p.edgeId)) return false;
      if (p.t < 1) {
        p.t = Math.min(1, p.t + (dt / TRAVEL_S) * p.speed);
        return true;
      }
      if (!p.drop) return false;
      p.fade += dt / FADE_S;
      return p.fade < 1;
    });

    const dpr = window.devicePixelRatio || 1;
    const scale = (el.clientWidth / viewWidth.value) * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, el.width, el.height);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);

    for (const p of particles) {
      const edge = byId.get(p.edgeId)!;
      const { x, y } = pointOnCurve(edge.curve, p.t);
      ctx.beginPath();
      if (p.fade > 0) {
        // Dropped at the target: a fading puff
        ctx.globalAlpha = 1 - p.fade;
        ctx.fillStyle = colors!.drop;
        ctx.arc(x, y, RADIUS + p.fade * 6, 0, Math.PI * 2);
      } else {
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = p.drop && p.t > 0.6 ? colors!.drop : colors![edge.kind];
        ctx.arc(x, y, RADIUS, 0, Math.PI * 2);
      }
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    schedule();
  }

  function schedule() {
    if (frame || !visible || motionQuery?.matches) return;
    frame = requestAnimationFrame(step);
  }

  function stop() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    last = 0;
  }

  function onMotionChange() {
    if (motionQuery?.matches) {
      stop();
      particles = [];
      const el = canvas.value;
      el?.getContext('2d')?.clearRect(0, 0, el.width, el.height);
    } else {
      schedule();
    }
  }

  onMounted(() => {
    const el = canvas.value;
    if (!el) return;
    fitCanvas();
    resizeObserver = new ResizeObserver(fitCanvas);
    resizeObserver.observe(el);
    intersectionObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) schedule();
      else stop();
    });
    intersectionObserver.observe(el);
    motionQuery?.addEventListener('change', onMotionChange);
    schedule();
  });

  onBeforeUnmount(() => {
    stop();
    resizeObserver?.disconnect();
    intersectionObserver?.disconnect();
    motionQuery?.removeEventListener('change', onMotionChange);
  });
}
