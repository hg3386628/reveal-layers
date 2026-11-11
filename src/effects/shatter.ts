import { clamp, dist, mulberry32, type Point } from "../geom.ts";
import { capturePolygon, drawPieces, stepPieces, type Piece } from "../pieces.ts";
import {
  createLayer,
  fadeLayer,
  type Effect,
  type Layer,
  type Pointer,
  type Surface,
} from "./types.ts";

type Shard = {
  points: Point[];
  cx: number;
  cy: number;
  attached: boolean;
  delay: number;
  cracked: boolean;
};

function tessellate(w: number, h: number, dpr: number): Shard[] {
  const cols = clamp(Math.round(w / (110 * dpr)), 6, 12);
  const rows = clamp(Math.round(h / (110 * dpr)), 8, 16);
  const rand = mulberry32((w * 13 + h) | 0);
  const pts: Point[][] = [];
  for (let y = 0; y <= rows; y++) {
    const row: Point[] = [];
    for (let x = 0; x <= cols; x++) {
      const jx = x === 0 || x === cols ? 0 : (rand() - 0.5) * (w / cols) * 0.7;
      const jy = y === 0 || y === rows ? 0 : (rand() - 0.5) * (h / rows) * 0.7;
      row.push({ x: (x / cols) * w + jx, y: (y / rows) * h + jy });
    }
    pts.push(row);
  }
  const shards: Shard[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const points = [pts[y][x], pts[y][x + 1], pts[y + 1][x + 1], pts[y + 1][x]];
      const cx = (points[0].x + points[1].x + points[2].x + points[3].x) / 4;
      const cy = (points[0].y + points[1].y + points[2].y + points[3].y) / 4;
      shards.push({ points, cx, cy, attached: true, delay: 0, cracked: false });
    }
  }
  return shards;
}

function punch(layer: Layer, points: Point[]) {
  const { ctx } = layer;
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function createShatter(): Effect {
  let surface: Surface | null = null;
  let layer: Layer | null = null;
  let shards: Shard[] = [];
  let pieces: Piece[] = [];
  let cracks: { a: Point; b: Point; t: number }[] = [];
  let detachedArea = 0;
  let totalArea = 1;
  let revealing = false;
  let gen = 0;

  const dpr = () => surface?.dpr ?? 1;

  const detach = (shard: Shard, from: Point, burst: number) => {
    if (!layer || !shard.attached) return;
    shard.attached = false;
    const area =
      Math.abs(
        (shard.points[0].x * shard.points[1].y - shard.points[1].x * shard.points[0].y) +
          (shard.points[1].x * shard.points[2].y - shard.points[2].x * shard.points[1].y) +
          (shard.points[2].x * shard.points[3].y - shard.points[3].x * shard.points[2].y) +
          (shard.points[3].x * shard.points[0].y - shard.points[0].x * shard.points[3].y)
      ) / 2;
    detachedArea += area;
    const ang = Math.atan2(shard.cy - from.y, shard.cx - from.x);
    const speed = burst * (0.6 + Math.random() * 0.8);
    const piece = capturePolygon(layer.canvas, shard.points, {
      vx: Math.cos(ang) * speed + (Math.random() - 0.5) * 80 * dpr(),
      vy: Math.sin(ang) * speed + (Math.random() * 80 - 20) * dpr(),
      vr: (Math.random() - 0.5) * 7,
      life: 2.5 + Math.random(),
    });
    punch(layer, shard.points);
    if (piece) pieces.push(piece);
  };

  const strike = (p: Pointer, radius: number, burst: number, wave = 0.0018) => {
    const impacts: Shard[] = [];
    for (const shard of shards) {
      if (!shard.attached) continue;
      const d = dist(p, { x: shard.cx, y: shard.cy });
      if (d <= radius) {
        shard.delay = d * wave;
        shard.cracked = true;
        impacts.push(shard);
        for (let i = 0; i < shard.points.length; i++) {
          cracks.push({
            a: shard.points[i],
            b: shard.points[(i + 1) % shard.points.length],
            t: shard.delay,
          });
        }
      }
    }
    // schedule detach after crack flash
    for (const shard of impacts) {
      const wait = shard.delay;
      const start = performance.now();
      const token = gen;
      const tick = () => {
        if (token !== gen || !shard.attached) return;
        if (surface?.reducedMotion) {
          detach(shard, p, burst);
          return;
        }
        if (performance.now() - start >= wait * 1000 + 70) detach(shard, p, burst);
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
  };

  return {
    id: "shatter",
    usesBrush: false,
    reset(next) {
      gen += 1;
      surface = next;
      layer = createLayer(next);
      shards = tessellate(next.width, next.height, next.dpr);
      pieces = [];
      cracks = [];
      detachedArea = 0;
      totalArea = next.width * next.height;
      revealing = false;
    },
    resize(next) {
      surface = next;
      // Tessellation is size-specific; rebuild and lose mid-air pieces.
      const ratio = this.clearedRatio();
      this.reset(next);
      if (ratio > 0.05) {
        // Re-apply approximate damage so a rotate does not fully restore the glass.
        revealing = ratio >= 0.65;
        if (revealing) this.forceReveal();
      }
    },
    pointerDown(p) {
      if (!layer || revealing) return;
      strike(p, 200 * dpr(), 520 * dpr());
    },
    pointerMove() {},
    pointerUp() {},
    update(dt) {
      if (!layer) return false;
      const reduced = surface?.reducedMotion ?? false;
      for (const crack of cracks) crack.t -= dt;
      cracks = cracks.filter((c) => c.t > -0.18);
      const anim = stepPieces(pieces, dt, 1700 * dpr(), reduced);
      if (revealing && layer) {
        fadeLayer(layer, dt, reduced);
      }
      return anim || cracks.length > 0 || revealing;
    },
    draw(ctx) {
      if (layer) ctx.drawImage(layer.canvas, 0, 0);
      ctx.save();
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      for (const crack of cracks) {
        const alpha = crack.t > 0 ? 0.15 : clamp(1 + crack.t / 0.18, 0, 1);
        ctx.strokeStyle = `rgba(255,255,255,${0.7 * alpha})`;
        ctx.lineWidth = 1.4 * dpr();
        ctx.beginPath();
        ctx.moveTo(crack.a.x, crack.a.y);
        ctx.lineTo(crack.b.x, crack.b.y);
        ctx.stroke();
        ctx.strokeStyle = `rgba(20,10,8,${0.45 * alpha})`;
        ctx.lineWidth = 0.8 * dpr();
        ctx.stroke();
      }
      ctx.restore();
      drawPieces(ctx, pieces);
    },
    clearedRatio: () => clamp(detachedArea / totalArea, 0, 1),
    forceReveal() {
      revealing = true;
      const { width, height } = layer?.canvas ?? { width: 1, height: 1 };
      const center = { x: width / 2, y: height / 2, id: -1 };
      for (const shard of shards) {
        if (!shard.attached) continue;
        shard.delay = dist(center, { x: shard.cx, y: shard.cy }) * 0.0009;
        shard.cracked = true;
      }
      strike(center, Math.hypot(width, height), 420 * dpr(), 0.0009);
    },
    dispose() {
      layer = null;
      shards = [];
      pieces = [];
      surface = null;
    },
  };
}
