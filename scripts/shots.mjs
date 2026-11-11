import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
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
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
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

function zigzag(w, h, coverage = 0.45) {
  const points = [];
  const marginX = w * 0.08;
  const top = h * 0.18;
  const bottom = h * (0.18 + 0.62 * coverage);
  const rows = 6;
  for (let i = 0; i <= rows; i++) {
    const y = top + ((bottom - top) * i) / rows;
    if (i % 2 === 0) points.push({ x: marginX, y }, { x: w - marginX, y });
    else points.push({ x: w - marginX, y }, { x: marginX, y });
  }
  return points;
}

function diagonal(w, h) {
  const points = [];
  const n = 28;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    points.push({
      x: w * 0.12 + t * w * 0.62 + Math.sin(t * 8) * 18,
      y: h * 0.18 + t * h * 0.55 + Math.cos(t * 6) * 14,
    });
  }
  return points;
}

async function mouseDrag(page, points, steps = 6) {
  await page.mouse.move(points[0].x, points[0].y);
  await page.mouse.down();
  for (const point of points.slice(1)) {
    await page.mouse.move(point.x, point.y, { steps });
  }
  await page.mouse.up();
}

async function touchDrag(page, points) {
  const client = await page.context().newCDPSession(page);
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: points[0].x, y: points[0].y, id: 0 }],
  });
  for (const point of points.slice(1)) {
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: point.x, y: point.y, id: 0 }],
    });
  }
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

async function ready(page) {
  await page.waitForFunction(() => {
    const title = document.querySelector("#hint-title");
    return Boolean(title && title.textContent);
  }, { timeout: 15_000 });
  await page.waitForTimeout(400);
}

async function hideUi(page) {
  await page.evaluate(() => document.body.classList.add("is-shot", "is-idle"));
}

async function setLevelAndEffect(page, level, effect) {
  await page.evaluate(() => document.body.classList.remove("is-shot", "is-idle"));
  await page.selectOption("#level", level, { force: true });
  await page.waitForTimeout(250);
  await page.selectOption("#effect", effect, { force: true });
  await page.waitForTimeout(150);
}

async function captureEffect(page, name, viewport, useTouch) {
  const { width: w, height: h } = viewport;
  const drag = useTouch ? touchDrag : mouseDrag;
  if (name === "scratch") {
    await setLevelAndEffect(page, "letter", "scratch");
    await drag(page, zigzag(w, h, 0.42));
  } else if (name === "tear") {
    await setLevelAndEffect(page, "letter", "tear");
    await drag(page, diagonal(w, h));
    await page.waitForTimeout(280);
  } else if (name === "fog") {
    await setLevelAndEffect(page, "window", "fog");
    const points = zigzag(w, h, 0.5).map((point) => ({ x: point.x, y: point.y + h * 0.28 }));
    await drag(page, points);
  } else if (name === "peel") {
    await setLevelAndEffect(page, "letter", "peel");
    const start = { x: w - 8, y: h - 8 };
    const end = { x: w * 0.42, y: h * 0.42 };
    const points = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      points.push({ x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t });
    }
    await drag(page, points, 4);
  } else if (name === "shatter") {
    await setLevelAndEffect(page, "city", "shatter");
    if (useTouch) {
      await page.touchscreen.tap(w * 0.38, h * 0.4);
      await page.waitForTimeout(80);
      await page.touchscreen.tap(w * 0.62, h * 0.55);
    } else {
      await page.mouse.click(w * 0.38, h * 0.4);
      await page.waitForTimeout(80);
      await page.mouse.click(w * 0.62, h * 0.55);
    }
    await page.waitForTimeout(420);
  }
  await hideUi(page);
  await page.waitForTimeout(40);
  const file = join(shotsDir, `${useTouch ? "mobile" : "desktop"}-${name}.png`);
  await page.screenshot({ path: file, type: "png" });
  return file;
}

const effects = ["scratch", "tear", "fog", "peel", "shatter"];

const { server, url } = await startStatic();
await mkdir(shotsDir, { recursive: true });
const errors = [];

const browser = await chromium.launch({
  executablePath: "/usr/bin/google-chrome",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  headless: true,
});

async function runViewport(name, viewport, useTouch) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: useTouch ? 2 : 1,
    hasTouch: useTouch,
    isMobile: useTouch,
    locale: "zh-CN",
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
  // confirm images load
  const failed = [];
  page.on("response", (res) => {
    if (res.url().includes("/images/") && res.status() !== 200) failed.push(res.url());
  });
  await ready(page);
  const files = [];
  for (const effect of effects) {
    files.push(await captureEffect(page, effect, viewport, useTouch));
    console.log("wrote", files.at(-1));
  }
  await context.close();
  if (failed.length) errors.push(`${name} image failures: ${failed.join(", ")}`);
  return files;
}

try {
  const desktop = await runViewport("desktop", { width: 1280, height: 800 }, false);
  const mobile = await runViewport("mobile", { width: 390, height: 844 }, true);
  await writeFile(join(shotsDir, "log.txt"), errors.length ? errors.join("\n") : "ok\n");
  console.log("done", { desktop, mobile, errors });
} finally {
  await browser.close();
  server.close();
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
}
