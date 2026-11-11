import { dist, hash2, type Point } from "../geom.ts";
import { capturePolygon, drawPieces, stepPieces, type Piece } from "../pieces.ts";
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

function raggedStrip(a: Point, b: Point, width: number, seed: number): Point[] {
  const len = dist(a, b);
  const steps = Math.max(2, Math.ceil(len / Math.max(6, width * 0.28)));
  const nx = (b.y - a.y) / (len || 1);
  const ny = (a.x - b.x) / (len || 1);
  const left: Point[] = [];
  const right: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = a.x + (b.x - a.x) * t;
    const y = a.y + (b.y - a.y) * t;
    const jagL = (hash2(seed, i) - 0.5) * width * 0.55 + Math.sin(t * 17 + seed) * width * 0.12;
    const jagR = (hash2(seed, i + 90) - 0.5) * width * 0.55 + Math.cos(t * 13 + seed) * width * 0.12;
    left.push({ x: x + nx * (width * 0.5 + jagL), y: y + ny * (width * 0.5 + jagL) });
    right.push({ x: x - nx * (width * 0.5 + jagR), y: y - ny * (width * 0.5 + jagR) });
  }
  return left.concat(right.reverse());
}

function punch(layer: Layer, points: Point[]) {
  if (points.length < 3) return;
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

export function createTear(): Effect {
  let surface: Surface | null = null;
  let layer: Layer | null = null;
  let last: Pointer | null = null;
  let pieces: Piece[] = [];
  let edges: Point[][] = [];
  let carry = 0;
  let dirtySamples = 0;
  let ratio = 0;
  let revealing = false;
  let active = false;
  let width = 40;

  const dpr = () => surface?.dpr ?? 1;

  return {
    id: "tear",
    usesBrush: false,
    reset(next) {
      surface = next;
      layer = createLayer(next);
      last = null;
      pieces = [];
      edges = [];
      carry = 0;
      dirtySamples = 0;
      ratio = 0;
      revealing = false;
      active = false;
      width = 28 * next.dpr;
    },
    resize(next) {
      surface = next;
      if (layer) scaleLayer(layer, next);
      else this.reset(next);
      pieces = [];
      edges = [];
    },
    pointerDown(p) {
      if (!layer || revealing) return;
      active = true;
      last = p;
      width = 24 * dpr();
    },
    pointerMove(p) {
      if (!layer || !active || !last || revealing) return;
      const travel = dist(last, p);
      if (travel < 4) return;
      width = Math.min(90 * dpr(), width + travel * 0.08);
      const poly = raggedStrip(last, p, width, (last.x + p.y) | 0);
      const piece = capturePolygon(layer.canvas, poly, {
        vx: (p.x - last.x) * 0.4 + (hash2(p.x, p.y) - 0.5) * 80 * dpr(),
        vy: Math.min(40, travel) * dpr() + 40 * dpr(),
        vr: (hash2(p.y, p.x) - 0.5) * 4,
        life: 2.2,
      });
      punch(layer, poly);
      edges.push(poly);
      if (edges.length > 8) edges.shift();
      carry += travel;
      if (piece && carry > 28 * dpr()) {
        pieces.push(piece);
        carry = 0;
      } else if (piece && pieces.length === 0) {
        pieces.push(piece);
      }
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
      const reduced = surface?.reducedMotion ?? false;
      let anim = stepPieces(pieces, dt, 1500 * dpr(), reduced);
      if (revealing) {
        fadeLayer(layer, dt, reduced);
        ratio = sampleCleared(layer.canvas);
        anim = ratio < 0.995 || anim;
      } else if (dirtySamples >= 5) {
        ratio = sampleCleared(layer.canvas);
        dirtySamples = 0;
      }
      return anim || active;
    },
    draw(ctx) {
      if (layer) ctx.drawImage(layer.canvas, 0, 0);
      ctx.save();
      ctx.strokeStyle = "rgba(40, 24, 12, 0.4)";
      ctx.lineWidth = 2.2 * dpr();
      ctx.lineJoin = "round";
      for (const poly of edges) {
        ctx.beginPath();
        ctx.moveTo(poly[0].x, poly[0].y);
        for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
        ctx.closePath();
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(255, 244, 226, 0.35)";
      ctx.lineWidth = 1 * dpr();
      for (const poly of edges) {
        ctx.beginPath();
        ctx.moveTo(poly[0].x, poly[0].y);
        for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
        ctx.closePath();
        ctx.stroke();
      }
      ctx.restore();
      drawPieces(ctx, pieces);
    },
    clearedRatio: () => ratio,
    forceReveal() {
      revealing = true;
      if (layer && surface && !surface.reducedMotion) {
        const { width: w, height: h } = layer.canvas;
        for (let i = 0; i < 7; i++) {
          const x = (w * (i + 0.5)) / 7;
          const poly = raggedStrip(
            { x, y: 0 },
            { x: x + (hash2(i, 2) - 0.5) * 80, y: h },
            70 * dpr(),
            i * 9
          );
          const piece = capturePolygon(layer.canvas, poly, {
            vx: (hash2(i, 1) - 0.5) * 260 * dpr(),
            vy: 80 * dpr() + hash2(i, 3) * 200 * dpr(),
            vr: (hash2(i, 4) - 0.5) * 5,
            life: 2.8,
          });
          punch(layer, poly);
          if (piece) pieces.push(piece);
        }
      }
    },
    dispose() {
      layer = null;
      pieces = [];
      surface = null;
    },
  };
}
