import type { Host } from "./host.ts";

export const mimeOf = (path: string) => {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
};

export function assetUrl(path: string) {
  return new URL(path, document.baseURI).href;
}

export async function loadJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}`);
  return (await response.json()) as T;
}

async function decodeBitmap(blob: Blob): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch {
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.decoding = "async";
      image.src = url;
      await image.decode();
      return image;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

export async function loadImage(path: string, host: Host): Promise<CanvasImageSource & { width: number; height: number }> {
  const bytes = await host.readAsset(path);
  if (bytes) {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const blob = new Blob([copy], { type: mimeOf(path) });
    return decodeBitmap(blob);
  }
  const response = await fetch(assetUrl(path));
  if (!response.ok) throw new Error(`Failed to fetch ${path}`);
  return decodeBitmap(await response.blob());
}

export function fitCover(
  image: CanvasImageSource & { width: number; height: number },
  width: number,
  height: number
) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext("2d", { alpha: false })!;
  const iw = image.width;
  const ih = image.height;
  const ir = iw / ih;
  const cr = canvas.width / canvas.height;
  let dw: number, dh: number, dx: number, dy: number;
  if (ir > cr) {
    dh = canvas.height;
    dw = dh * ir;
    dx = (canvas.width - dw) / 2;
    dy = 0;
  } else {
    dw = canvas.width;
    dh = dw / ir;
    dx = 0;
    dy = (canvas.height - dh) / 2;
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, dx, dy, dw, dh);
  return canvas;
}

export function cloneCanvas(source: HTMLCanvasElement) {
  const copy = document.createElement("canvas");
  copy.width = source.width;
  copy.height = source.height;
  copy.getContext("2d")!.drawImage(source, 0, 0);
  return copy;
}
