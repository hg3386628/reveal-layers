import { centroid, pathOf, polygonBounds, type Point } from "./geom.ts";

export type Piece = {
  canvas: HTMLCanvasElement;
  ox: number;
  oy: number;
  cx: number;
  cy: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  vr: number;
  rot: number;
  life: number;
  age: number;
};

export function capturePolygon(
  source: HTMLCanvasElement,
  points: Point[],
  extra?: { vx?: number; vy?: number; vr?: number; life?: number }
): Piece | null {
  if (points.length < 3) return null;
  const b = polygonBounds(points);
  const pad = 10;
  const w = Math.max(1, Math.ceil(b.w + pad * 2));
  const h = Math.max(1, Math.ceil(b.h + pad * 2));
  if (w * h > 12_000_000) return null;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.translate(-b.minX + pad, -b.minY + pad);
  ctx.beginPath();
  pathOf(ctx, points, true);
  ctx.clip();
  ctx.drawImage(source, 0, 0);
  ctx.strokeStyle = "rgba(40, 24, 12, 0.4)";
  ctx.lineWidth = 2.2;
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.strokeStyle = "rgba(255, 244, 230, 0.45)";
  ctx.lineWidth = 1;
  ctx.stroke();
  const c = centroid(points);
  return {
    canvas,
    ox: b.minX - pad,
    oy: b.minY - pad,
    cx: c.x - (b.minX - pad),
    cy: c.y - (b.minY - pad),
    x: 0,
    y: 0,
    vx: extra?.vx ?? 0,
    vy: extra?.vy ?? 0,
    vr: extra?.vr ?? 0,
    rot: 0,
    life: extra?.life ?? 2.6,
    age: 0,
  };
}

export function stepPieces(
  pieces: Piece[],
  dt: number,
  gravity: number,
  reducedMotion: boolean
) {
  if (reducedMotion) {
    pieces.length = 0;
    return false;
  }
  const drag = Math.pow(0.986, dt * 60);
  for (let i = pieces.length - 1; i >= 0; i--) {
    const p = pieces[i];
    p.age += dt;
    p.vy += gravity * dt;
    p.vx *= drag;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;
    if (p.age > p.life) pieces.splice(i, 1);
  }
  return pieces.length > 0;
}

export function drawPieces(ctx: CanvasRenderingContext2D, pieces: Piece[]) {
  for (const p of pieces) {
    const fade = Math.max(0, 1 - (p.age / p.life) ** 3.2);
    ctx.save();
    ctx.globalAlpha = fade;
    ctx.translate(p.ox + p.cx + p.x, p.oy + p.cy + p.y);
    ctx.rotate(p.rot);
    ctx.shadowColor = "rgba(0,0,0,0.38)";
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 10;
    ctx.drawImage(p.canvas, -p.cx, -p.cy);
    ctx.shadowColor = "transparent";
    const shade = ctx.createLinearGradient(-p.cx, -p.cy, p.canvas.width - p.cx, p.canvas.height - p.cy);
    shade.addColorStop(0, "rgba(0,0,0,0.18)");
    shade.addColorStop(0.45, "rgba(255,255,255,0.08)");
    shade.addColorStop(1, "rgba(40,20,10,0.22)");
    ctx.fillStyle = shade;
    ctx.fillRect(-p.cx, -p.cy, p.canvas.width, p.canvas.height);
    ctx.restore();
  }
}
