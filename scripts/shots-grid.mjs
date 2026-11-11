import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dist = join(root, "dist/pages");
const shotsDir = join(root, "shots");
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".webmanifest": "application/manifest+json",
};

function startStatic() {
  return new Promise((resolveServer) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      let path = join(dist, decodeURIComponent(url.pathname));
      if (path.endsWith("/")) path = join(path, "index.html");
      if (!existsSync(path) || statSync(path).isDirectory()) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      res.writeHead(200, { "content-type": mime[extname(path)] || "application/octet-stream" });
      createReadStream(path).pipe(res);
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolveServer({ server, url: `http://127.0.0.1:${port}/` });
    });
  });
}

const { server, url } = await startStatic();
await mkdir(shotsDir, { recursive: true });
const errors = [];
const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  headless: true,
});

async function shot(name, viewport, useTouch) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: useTouch ? 2 : 1,
    hasTouch: useTouch,
    isMobile: useTouch,
    locale: "zh-CN",
  });
  await context.addInitScript(() => {
    localStorage.setItem("reveal-layers:completed", JSON.stringify(["window"]));
    localStorage.setItem("reveal-layers:level", "letter");
  });
  const page = await context.newPage();
  page.on("pageerror", (err) => errors.push(`${name}: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`${name} console: ${msg.text()}`);
  });
  const response = await page.goto(url, { waitUntil: "networkidle" });
  if (!response || response.status() !== 200) {
    throw new Error(`${name} failed to load: ${response?.status()}`);
  }
  await page.waitForSelector(".level-card img[src]", { timeout: 15_000 });
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".level-card img")].every((img) => img.complete && img.naturalWidth > 0)
  );
  await page.waitForTimeout(200);
  const file = join(shotsDir, `${name}-level-grid.png`);
  await page.screenshot({ path: file, type: "png", fullPage: true });
  console.log("wrote", file);
  await context.close();
  return file;
}

try {
  await shot("desktop", { width: 1280, height: 800 }, false);
  await shot("mobile", { width: 390, height: 844 }, true);
} finally {
  await browser.close();
  server.close();
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log("grid shots ok");
}
