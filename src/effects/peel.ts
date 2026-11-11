import {
  clamp,
  clipHalfPlane,
  dist,
  pathOf,
  polygonArea,
  rectPolygon,
  reflectPoint,
  type Point,
} from "../geom.ts";
import type { Effect, Surface } from "./types.ts";

const cornersOf = (w: number, h: number): Point[] => [
  { x: 0, y: 0 },
  { x: w, y: 0 },
  { x: w, y: h },
  { x: 0, y: h },
];

function nearestCorner(p: Point, corners: Point[]) {
  let best = 0;
  let bestD = Infinity;
  corners.forEach((c, i) => {
    const d = dist(p, c);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return { index: best, corner: corners[best], distance: bestD };
}

function constrainPeel(corner: Point, pointer: Point, w: number, h: number): Point {
  // Keep the fold on the sheet: the midpoint of C and P must stay inside
  // a slightly inset rectangle, and P stays on the interior side of C.
  const maxDist = Math.hypot(w, h) * 1.15;
  const dx = pointer.x - corner.x;
  const dy = pointer.y - corner.y;
  const len = Math.hypot(dx, dy) || 1;
  const scale = Math.min(1, maxDist / len);
  let x = corner.x + dx * scale;
  let y = corner.y + dy * scale;
  x = clamp(x, -w * 0.15, w * 1.15);
  y = clamp(y, -h * 0.15, h * 1.15);
  return { x, y };
}

type PeelState = {
  corner: Point;
  point: Point;
};

export function createPeel(): Effect {
  let surface: Surface | null = null;
  let state: PeelState | null = null;
  let dragging = false;
  let flying = false;
  let flyVel = { x: 0, y: 0 };
  let settled = false;
  let ratio = 0;
  let hover: Point | null = null;

  const size = () => ({
    w: surface?.width ?? 1,
    h: surface?.height ?? 1,
    dpr: surface?.dpr ?? 1,
  });

  const measure = (peel: PeelState) => {
    const { w, h } = size();
    const dx = peel.point.x - peel.corner.x;
    const dy = peel.point.y - peel.corner.y;
    const len = Math.hypot(dx, dy);
    if (len < 2) return { ratio: 0, nx: 1, ny: 0, c: 0, len, peeled: [] as Point[], rest: rectPolygon(w, h) };
    const nx = dx / len;
    const ny = dy / len;
    const midX = (peel.point.x + peel.corner.x) / 2;
    const midY = (peel.point.y + peel.corner.y) / 2;
    const c = nx * midX + ny * midY;
    const rect = rectPolygon(w, h);
    const peeled = clipHalfPlane(rect, nx, ny, c, false);
    const rest = clipHalfPlane(rect, nx, ny, c, true);
    return { ratio: polygonArea(peeled) / (w * h), nx, ny, c, len, peeled, rest };
  };

  return {
    id: "peel",
    usesBrush: false,
    reset(next) {
      surface = next;
      state = null;
      dragging = false;
      flying = false;
      settled = false;
      ratio = 0;
      hover = null;
    },
    resize(next) {
      const old = surface;
      const sx = next.width / (old?.width || next.width);
      const sy = next.height / (old?.height || next.height);
      surface = next;
      if (state) {
        state = {
          corner: { x: state.corner.x * sx, y: state.corner.y * sy },
          point: { x: state.point.x * sx, y: state.point.y * sy },
        };
        ratio = measure(state).ratio;
      }
    },
    pointerDown(p) {
      if (settled || flying || !surface) return;
      const { w, h } = size();
      const found = nearestCorner(p, cornersOf(w, h));
      state = { corner: found.corner, point: p };
      dragging = true;
      ratio = measure(state).ratio;
    },
    pointerMove(p) {
      hover = p;
      if (!dragging || !state || flying || settled) return;
      const { w, h } = size();
      state = { ...state, point: constrainPeel(state.corner, p, w, h) };
      ratio = measure(state).ratio;
    },
    pointerUp() {
      dragging = false;
      if (state && ratio > 0.52) this.forceReveal();
    },
    update(dt) {
      if (!state) return false;
      if (flying && !settled) {
        const { w, h, dpr } = size();
        flyVel.y += 1800 * dpr * dt;
        state = {
          ...state,
          point: {
            x: state.point.x + flyVel.x * dt,
            y: state.point.y + flyVel.y * dt,
          },
        };
        const m = measure(state);
        ratio = Math.min(1, m.ratio);
        if (m.ratio > 0.97 || dist(state.point, { x: w / 2, y: h / 2 }) > Math.hypot(w, h) * 1.4) {
          settled = true;
          ratio = 1;
          state = null;
          return false;
        }
        return true;
      }
      return dragging;
    },
    draw(ctx, current) {
      const { w, h, dpr } = size();
      if (settled || !surface) return;

      if (!state) {
        ctx.drawImage(current.top, 0, 0, w, h);
        // dog-ear hints
        const ears = cornersOf(w, h);
        const reach = 54 * dpr;
        ears.forEach((c, i) => {
          const inward = { x: i === 0 || i === 3 ? 1 : -1, y: i < 2 ? 1 : -1 };
          const tip = { x: c.x + inward.x * reach, y: c.y + inward.y * reach * 0.85 };
          const near = hover && dist(hover, c) < 140 * dpr;
          const lift = near ? 1 : 0.7;
          const a = { x: c.x + inward.x * reach * lift, y: c.y };
          const b = { x: c.x, y: c.y + inward.y * reach * lift };
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(c.x, c.y);
          ctx.lineTo(a.x, a.y);
          ctx.lineTo(tip.x * lift + c.x * (1 - lift), tip.y * lift + c.y * (1 - lift));
          ctx.lineTo(b.x, b.y);
          ctx.closePath();
          ctx.fillStyle = "rgba(255, 244, 230, 0.85)";
          ctx.shadowColor = "rgba(0,0,0,0.28)";
          ctx.shadowBlur = 10 * dpr;
          ctx.fill();
          ctx.shadowColor = "transparent";
          ctx.strokeStyle = "rgba(80, 50, 30, 0.25)";
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.restore();
        });
        return;
      }

      const m = measure(state);
      ratio = m.ratio;
      if (m.rest.length) {
        ctx.save();
        ctx.beginPath();
        pathOf(ctx, m.rest, true);
        ctx.clip();
        ctx.drawImage(current.top, 0, 0, w, h);
        ctx.restore();
      }

      if (m.peeled.length < 3) return;

      const flap = m.peeled.map((p) => reflectPoint(p, m.nx, m.ny, m.c));

      // shadow of the missing region / under the fold
      ctx.save();
      ctx.beginPath();
      pathOf(ctx, m.peeled, true);
      ctx.clip();
      const shadow = ctx.createLinearGradient(
        state.corner.x,
        state.corner.y,
        state.corner.x + m.nx * 80 * dpr,
        state.corner.y + m.ny * 80 * dpr
      );
      shadow.addColorStop(0, "rgba(0,0,0,0)");
      shadow.addColorStop(0.6, "rgba(0,0,0,0.18)");
      shadow.addColorStop(1, "rgba(0,0,0,0.28)");
      ctx.fillStyle = shadow;
      ctx.fill();
      ctx.restore();

      // flap underside
      ctx.save();
      ctx.beginPath();
      pathOf(ctx, flap, true);
      ctx.shadowColor = "rgba(0,0,0,0.4)";
      ctx.shadowBlur = 22 * dpr;
      ctx.shadowOffsetX = m.nx * 8 * dpr;
      ctx.shadowOffsetY = 12 * dpr + m.ny * 6 * dpr;
      ctx.fillStyle = "#d8c4a4";
      ctx.fill();
      ctx.shadowColor = "transparent";
      ctx.clip();
      ctx.save();
      // Weak reflected image so the back still reads as the same sticker
      ctx.filter = "brightness(0.78) saturate(0.55)";
      const midX = (state.point.x + state.corner.x) / 2;
      const midY = (state.point.y + state.corner.y) / 2;
      ctx.translate(midX, midY);
      // reflect over the fold by scaling in the n direction
      ctx.transform(1 - 2 * m.nx * m.nx, -2 * m.nx * m.ny, -2 * m.nx * m.ny, 1 - 2 * m.ny * m.ny, 0, 0);
      ctx.translate(-midX, -midY);
      ctx.drawImage(current.top, 0, 0, w, h);
      ctx.restore();
      const gloss = ctx.createLinearGradient(
        state.corner.x,
        state.corner.y,
        state.point.x,
        state.point.y
      );
      gloss.addColorStop(0, "rgba(40, 24, 12, 0.28)");
      gloss.addColorStop(0.45, "rgba(255, 255, 255, 0.28)");
      gloss.addColorStop(1, "rgba(80, 50, 20, 0.18)");
      ctx.fillStyle = gloss;
      ctx.fill();
      ctx.restore();

      // fold highlight
      ctx.save();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
      ctx.lineWidth = 2 * dpr;
      ctx.beginPath();
      // fold is the shared edge between rest and peeled — approximate with the
      // intersection points already in both polygons
      const fold = m.rest.filter((p) => Math.abs(m.nx * p.x + m.ny * p.y - m.c) < 1.5 * dpr);
      if (fold.length >= 2) {
        ctx.moveTo(fold[0].x, fold[0].y);
        ctx.lineTo(fold[fold.length - 1].x, fold[fold.length - 1].y);
        ctx.stroke();
        ctx.strokeStyle = "rgba(40, 20, 10, 0.35)";
        ctx.lineWidth = 1 * dpr;
        ctx.stroke();
      }
      ctx.restore();
    },
    clearedRatio: () => (settled ? 1 : ratio),
    forceReveal() {
      if (settled || !state || !surface) {
        settled = true;
        ratio = 1;
        state = null;
        return;
      }
      if (surface.reducedMotion) {
        settled = true;
        ratio = 1;
        state = null;
        return;
      }
      flying = true;
      const { dpr } = size();
      const dx = state.point.x - state.corner.x;
      const dy = state.point.y - state.corner.y;
      const len = Math.hypot(dx, dy) || 1;
      flyVel = { x: (dx / len) * 900 * dpr, y: (dy / len) * 900 * dpr - 200 * dpr };
    },
    dispose() {
      surface = null;
      state = null;
    },
  };
}
