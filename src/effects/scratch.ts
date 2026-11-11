import { dist, hash2, type Point } from "../geom.ts";
import {
  createLayer,
  fadeLayer,
  sampleCleared,
  scaleLayer,
  type Effect,
  type Layer,
  type Pointer,
  type Surface,
} from "./types.ts";

function stamp(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  seed: number
) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  const n = 9;
  for (let i = 0; i < n; i++) {
    const a = hash2(seed, i) * Math.PI * 2;
    const d = radius * (0.62 + hash2(seed, i + 11) * 0.55);
    const r = radius * (0.12 + hash2(seed, i + 23) * 0.28);
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function strokeTo(
  ctx: CanvasRenderingContext2D,
  a: Point,
  b: Point,
  radius: number
) {
  const gap = Math.max(2, radius * 0.28);
  const n = Math.max(1, Math.ceil(dist(a, b) / gap));
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = "#000";
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    stamp(
      ctx,
      a.x + (b.x - a.x) * t,
      a.y + (b.y - a.y) * t,
      radius,
      (a.x * 13 + b.x + i * 17) | 0
    );
  }
  ctx.restore();
}

export function createScratch(): Effect {
  let surface: Surface | null = null;
  let layer: Layer | null = null;
  let last: Pointer | null = null;
  let dirtySamples = 0;
  let ratio = 0;
  let revealing = false;
  let active = false;

  const radius = () =>
    Math.max(10, (surface?.brushCss ?? 42) * (surface?.dpr ?? 1) * 0.55);

  return {
    id: "scratch",
    usesBrush: true,
    reset(next) {
      surface = next;
      layer = createLayer(next);
      last = null;
      dirtySamples = 0;
      ratio = 0;
      revealing = false;
      active = false;
    },
    resize(next) {
      surface = next;
      if (layer) scaleLayer(layer, next);
      else this.reset(next);
    },
    pointerDown(p) {
      if (!layer || revealing) return;
      active = true;
      last = p;
      strokeTo(layer.ctx, p, p, radius());
      dirtySamples = 8;
    },
    pointerMove(p) {
      if (!layer || !active || !last || revealing) return;
      strokeTo(layer.ctx, last, p, radius());
      last = p;
      dirtySamples++;
    },
    pointerUp() {
      active = false;
      last = null;
      dirtySamples = 99;
    },
    update(dt) {
      if (!layer) return false;
      if (revealing) {
        fadeLayer(layer, dt, surface?.reducedMotion ?? false);
        ratio = sampleCleared(layer.canvas);
        return ratio < 0.995;
      }
      if (dirtySamples >= 6) {
        ratio = sampleCleared(layer.canvas);
        dirtySamples = 0;
      }
      return active;
    },
    draw(ctx) {
      if (layer) ctx.drawImage(layer.canvas, 0, 0);
    },
    clearedRatio: () => ratio,
    forceReveal() {
      revealing = true;
    },
    dispose() {
      layer = null;
      surface = null;
    },
  };
}
