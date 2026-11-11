import type { Point } from "../geom.ts";

export const AUTO_REVEAL = 0.65;

export type Surface = {
  width: number;
  height: number;
  dpr: number;
  cssWidth: number;
  cssHeight: number;
  top: HTMLCanvasElement;
  bottom: HTMLCanvasElement;
  reducedMotion: boolean;
  brushCss: number;
};

export type Pointer = Point & { id: number };

export interface Effect {
  readonly id: string;
  readonly usesBrush: boolean;
  reset(surface: Surface): void;
  resize(surface: Surface): void;
  pointerDown(p: Pointer): void;
  pointerMove(p: Pointer): void;
  pointerUp(p: Pointer): void;
  update(dt: number): boolean;
  draw(ctx: CanvasRenderingContext2D, surface: Surface): void;
  clearedRatio(): number;
  forceReveal(): void;
  dispose(): void;
}

export type Layer = {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
};

const sampler = document.createElement("canvas");
const samplerCtx = sampler.getContext("2d", { willReadFrequently: true })!;

export function createLayer(surface: Surface, source: CanvasImageSource = surface.top): Layer {
  const canvas = document.createElement("canvas");
  canvas.width = surface.width;
  canvas.height = surface.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return { canvas, ctx };
}

export function scaleLayer(layer: Layer, surface: Surface) {
  const canvas = document.createElement("canvas");
  canvas.width = surface.width;
  canvas.height = surface.height;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(layer.canvas, 0, 0, canvas.width, canvas.height);
  layer.canvas = canvas;
  layer.ctx = ctx;
}

export function sampleCleared(canvas: HTMLCanvasElement) {
  const w = 80;
  const h = Math.max(1, Math.round((80 * canvas.height) / Math.max(1, canvas.width)));
  if (sampler.width !== w) sampler.width = w;
  if (sampler.height !== h) sampler.height = h;
  samplerCtx.clearRect(0, 0, w, h);
  samplerCtx.drawImage(canvas, 0, 0, w, h);
  const data = samplerCtx.getImageData(0, 0, w, h).data;
  let cleared = 0;
  const n = w * h;
  for (let i = 0; i < n; i++) {
    if (data[i * 4 + 3] < 28) cleared++;
  }
  return cleared / n;
}

export function fadeLayer(layer: Layer, dt: number, reduced: boolean) {
  layer.ctx.save();
  layer.ctx.globalCompositeOperation = "destination-out";
  const a = reduced ? 1 : 1 - Math.pow(0.84, dt * 60);
  layer.ctx.fillStyle = `rgba(0,0,0,${a})`;
  layer.ctx.fillRect(0, 0, layer.canvas.width, layer.canvas.height);
  layer.ctx.restore();
}
