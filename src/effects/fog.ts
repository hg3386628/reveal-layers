import { dist, type Point } from "../geom.ts";
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

function frostLayer(surface: Surface): Layer {
  const layer = createLayer(surface);
  const { ctx, canvas } = layer;
  const blur = Math.max(6, 10 * surface.dpr);
  ctx.filter = `blur(${blur}px)`;
  ctx.drawImage(surface.top, 0, 0, canvas.width, canvas.height);
  ctx.filter = "none";
  ctx.fillStyle = "rgba(228, 238, 246, 0.32)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
  const step = Math.max(3, 4 * surface.dpr);
  for (let y = 0; y < canvas.height; y += step * 2) {
    for (let x = 0; x < canvas.width; x += step * 2) {
      if (((x * 13 + y * 7) & 7) === 0) ctx.fillRect(x, y, step, step);
    }
  }
  return layer;
}

function wipe(
  ctx: CanvasRenderingContext2D,
  a: Point,
  b: Point,
  radius: number
) {
  const gap = Math.max(2, radius * 0.22);
  const n = Math.max(1, Math.ceil(dist(a, b) / gap));
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = "rgba(0,0,0,0.88)";
  ctx.shadowColor = "rgba(0,0,0,0.85)";
  ctx.shadowBlur = Math.max(8, radius * 0.65);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.ellipse(0, 0, radius * 1.25, radius * 0.62, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

export function createFog(): Effect {
  let surface: Surface | null = null;
  let layer: Layer | null = null;
  let last: Pointer | null = null;
  let dirtySamples = 0;
  let ratio = 0;
  let revealing = false;
  let active = false;

  const radius = () =>
    Math.max(14, (surface?.brushCss ?? 48) * (surface?.dpr ?? 1) * 0.7);

  return {
    id: "fog",
    usesBrush: true,
    reset(next) {
      surface = next;
      layer = frostLayer(next);
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
      wipe(layer.ctx, p, p, radius());
      dirtySamples = 8;
    },
    pointerMove(p) {
      if (!layer || !active || !last || revealing) return;
      wipe(layer.ctx, last, p, radius());
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
