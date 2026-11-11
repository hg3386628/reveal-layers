export type Point = { x: number; y: number };

export const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const dist = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);

export const mid = (a: Point, b: Point): Point => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});

export function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(x: number, y: number) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

export function polygonArea(points: Point[]) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

export function polygonBounds(points: Point[]) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

export function centroid(points: Point[]): Point {
  let x = 0,
    y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  const n = Math.max(1, points.length);
  return { x: x / n, y: y / n };
}

function intersect(
  a: Point,
  b: Point,
  nx: number,
  ny: number,
  c: number
): Point {
  const ad = nx * a.x + ny * a.y - c;
  const bd = nx * b.x + ny * b.y - c;
  const t = ad / (ad - bd || 1e-8);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Keep the side of nx*x + ny*y ? c. */
export function clipHalfPlane(
  poly: Point[],
  nx: number,
  ny: number,
  c: number,
  keepPositive: boolean
): Point[] {
  if (poly.length === 0) return [];
  const keep = (p: Point) => {
    const d = nx * p.x + ny * p.y - c;
    return keepPositive ? d >= -1e-6 : d <= 1e-6;
  };
  const out: Point[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ain = keep(a);
    const bin = keep(b);
    if (ain && bin) out.push(b);
    else if (ain && !bin) out.push(intersect(a, b, nx, ny, c));
    else if (!ain && bin) {
      out.push(intersect(a, b, nx, ny, c));
      out.push(b);
    }
  }
  return out;
}

export function reflectPoint(p: Point, nx: number, ny: number, c: number): Point {
  const d = nx * p.x + ny * p.y - c;
  return { x: p.x - 2 * d * nx, y: p.y - 2 * d * ny };
}

export function pathOf(ctx: CanvasRenderingContext2D, points: Point[], close = true) {
  if (!points.length) return;
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  if (close) ctx.closePath();
}

export const rectPolygon = (w: number, h: number): Point[] => [
  { x: 0, y: 0 },
  { x: w, y: 0 },
  { x: w, y: h },
  { x: 0, y: h },
];
