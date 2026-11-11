import { fitCover, loadImage } from "./assets.ts";
import { createEffect, effectIds, isEffectId, AUTO_REVEAL, type Effect, type EffectId, type Surface } from "./effects/index.ts";
import type { Host } from "./host.ts";
import { levelById, levels, type Level } from "./levels.ts";

const PREF_EFFECT = "reveal-layers:effect";
const PREF_LEVEL = "reveal-layers:level";
const PREF_BRUSH = "reveal-layers:brush";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export async function startApp(host: Host) {
  const canvas = $<HTMLCanvasElement>("stage");
  const ctx = canvas.getContext("2d")!;
  const toolbar = $<HTMLDivElement>("toolbar");
  const effectSelect = $<HTMLSelectElement>("effect");
  const levelSelect = $<HTMLSelectElement>("level");
  const brushInput = $<HTMLInputElement>("brush");
  const brushField = $<HTMLLabelElement>("brush-field");
  const resetBtn = $<HTMLButtonElement>("reset");
  const fsBtn = $<HTMLButtonElement>("fullscreen");
  const menuBtn = $<HTMLButtonElement>("menu-toggle");
  const hintTitle = $<HTMLElement>("hint-title");
  const hintCopy = $<HTMLElement>("hint-copy");
  const noticeEl = $<HTMLElement>("notice");

  let localeReady = false;
  let reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let effectId: EffectId = "scratch";
  let level: Level = levels[0];
  let effect: Effect = createEffect(effectId);
  let surface: Surface | null = null;
  let topSrc: (CanvasImageSource & { width: number; height: number }) | null = null;
  let bottomSrc: (CanvasImageSource & { width: number; height: number }) | null = null;
  const imageCache = new Map<string, CanvasImageSource & { width: number; height: number }>();
  let revealed = false;
  let running = false;
  let lastTs = 0;
  let activePointer: number | null = null;
  let idleTimer = 0;
  let noticeTimer = 0;
  let starting = true;

  const t = (key: string, values?: object) => host.t(key, values);

  function localize() {
    document.querySelectorAll<HTMLElement>("[data-text]").forEach((node) => {
      node.textContent = t(node.dataset.text!);
    });
    canvas.setAttribute("aria-label", t("board"));
    hintTitle.textContent = t(level.id);
    const hintKey =
      effectId === "peel" ? "hintPeel" : effectId === "shatter" ? "hintShatter" : "hint";
    hintCopy.textContent = t(hintKey);
    fillSelect(effectSelect, effectIds, (id) => t(id), effectId);
    fillSelect(levelSelect, levels.map((item) => item.id), (id) => t(id), level.id);
    brushInput.value = String(Math.round(surface?.brushCss ?? (Number(brushInput.value) || 42)));
    brushField.hidden = !effect.usesBrush;
    fsBtn.textContent = isFullscreen() ? t("exitFullscreen") : t("fullscreen");
    document.title = t("title");
    localeReady = true;
  }

  function fillSelect(
    select: HTMLSelectElement,
    ids: readonly string[],
    label: (id: string) => string,
    current: string
  ) {
    select.textContent = "";
    for (const id of ids) {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = label(id);
      select.append(opt);
    }
    select.value = current;
  }

  function isUi(target: EventTarget | null) {
    return target instanceof Element && Boolean(target.closest(".toolbar, .fab, select, input, button"));
  }

  function pokeUi(hide = false) {
    window.clearTimeout(idleTimer);
    if (hide) {
      document.body.classList.add("is-idle");
      menuBtn.setAttribute("aria-expanded", "false");
      return;
    }
    document.body.classList.remove("is-idle");
    menuBtn.setAttribute("aria-expanded", "true");
    idleTimer = window.setTimeout(() => pokeUi(true), 2800);
  }

  function notice(text: string) {
    noticeEl.textContent = text;
    noticeEl.classList.toggle("is-on", Boolean(text));
    window.clearTimeout(noticeTimer);
    if (text) noticeTimer = window.setTimeout(() => notice(""), 2400);
  }

  function isFullscreen() {
    const doc = document as Document & { webkitFullscreenElement?: Element | null };
    return Boolean(
      document.fullscreenElement ||
        doc.webkitFullscreenElement ||
        document.body.classList.contains("is-immersive")
    );
  }

  async function toggleFullscreen() {
    const doc = document as Document & {
      webkitFullscreenElement?: Element | null;
      webkitExitFullscreen?: () => Promise<void> | void;
    };
    const root = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void> | void;
    };
    const wantOn = !isFullscreen();
    const sdkResult = wantOn ? await host.requestFullscreen() : await host.exitFullscreen();
    if (sdkResult) {
      fsBtn.textContent = t(wantOn ? "exitFullscreen" : "fullscreen");
      return;
    }
    try {
      if (!wantOn) {
        if (document.fullscreenElement) await document.exitFullscreen();
        else if (doc.webkitFullscreenElement) await doc.webkitExitFullscreen?.();
        document.body.classList.remove("is-immersive");
        return;
      }
      if (root.requestFullscreen) {
        await root.requestFullscreen();
        return;
      }
      if (root.webkitRequestFullscreen) {
        await root.webkitRequestFullscreen();
        return;
      }
    } catch {
      /* fall through to the iOS-style immersive fallback */
    }
    document.body.classList.toggle("is-immersive", wantOn);
    pokeUi(wantOn);
    fsBtn.textContent = t(wantOn ? "exitFullscreen" : "fullscreen");
  }

  async function readPref(key: string) {
    const fromHost = await host.load(key);
    if (typeof fromHost === "string" && fromHost) return fromHost;
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function writePref(key: string, value: string) {
    void host.save(key, value);
    try {
      localStorage.setItem(key, value);
    } catch {
      /* private mode or sandboxed */
    }
  }

  async function loadLevelImages(next: Level) {
    const load = async (path: string) => {
      const cached = imageCache.get(path);
      if (cached) return cached;
      const image = await loadImage(path, host);
      imageCache.set(path, image);
      return image;
    };
    const [top, bottom] = await Promise.all([load(next.top), load(next.bottom)]);
    topSrc = top;
    bottomSrc = bottom;
  }

  function currentBrush() {
    return Number(brushInput.value) || 42;
  }

  function makeSurface(cssWidth: number, cssHeight: number, dpr: number): Surface | null {
    if (!topSrc || !bottomSrc) return null;
    const width = Math.max(1, Math.round(cssWidth * dpr));
    const height = Math.max(1, Math.round(cssHeight * dpr));
    return {
      width,
      height,
      dpr,
      cssWidth,
      cssHeight,
      top: fitCover(topSrc, width, height),
      bottom: fitCover(bottomSrc, width, height),
      reducedMotion,
      brushCss: currentBrush(),
    };
  }

  function layout(resetEffect = false) {
    const vv = window.visualViewport;
    const cssW = Math.max(1, vv?.width ?? document.documentElement.clientWidth ?? window.innerWidth);
    const cssH = Math.max(1, vv?.height ?? document.documentElement.clientHeight ?? window.innerHeight);
    const left = vv?.offsetLeft ?? 0;
    const top = vv?.offsetTop ?? 0;
    canvas.style.left = `${left}px`;
    canvas.style.top = `${top}px`;
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const next = makeSurface(cssW, cssH, dpr);
    if (!next) return;
    const resized =
      !surface || surface.width !== next.width || surface.height !== next.height;
    surface = next;
    if (canvas.width !== next.width) canvas.width = next.width;
    if (canvas.height !== next.height) canvas.height = next.height;
    if (resetEffect || starting) {
      effect.reset(next);
      revealed = false;
      starting = false;
    } else if (resized) {
      effect.resize(next);
    }
    paint();
  }

  function paint() {
    if (!surface) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(surface.bottom, 0, 0);
    effect.draw(ctx, surface);
  }

  function kick() {
    if (running || document.hidden) return;
    running = true;
    lastTs = performance.now();
    requestAnimationFrame(frame);
  }

  function frame(ts: number) {
    if (!running) return;
    const dt = Math.min(0.05, (ts - lastTs) / 1000 || 0.016);
    lastTs = ts;
    const anim = effect.update(dt);
    if (!revealed && effect.clearedRatio() >= AUTO_REVEAL) {
      revealed = true;
      effect.forceReveal();
      notice(t("revealed"));
    }
    paint();
    if (anim) requestAnimationFrame(frame);
    else running = false;
  }

  function pointFrom(ev: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    const width = rect.width || 1;
    const height = rect.height || 1;
    return {
      x: ((ev.clientX - rect.left) / width) * canvas.width,
      y: ((ev.clientY - rect.top) / height) * canvas.height,
      id: ev.pointerId,
    };
  }

  async function applyLevel(id: string, persist = true) {
    level = levelById(id);
    try {
      await loadLevelImages(level);
    } catch (error) {
      console.warn(error);
      notice(t("loadError"));
      return;
    }
    starting = true;
    layout(true);
    localize();
    if (persist) writePref(PREF_LEVEL, level.id);
    kick();
  }

  function applyEffect(id: string, persist = true) {
    const nextId: EffectId = isEffectId(id) ? id : "scratch";
    effect.dispose();
    effectId = nextId;
    effect = createEffect(effectId);
    revealed = false;
    if (surface) effect.reset(surface);
    brushField.hidden = !effect.usesBrush;
    effectSelect.value = effectId;
    localize();
    if (persist) writePref(PREF_EFFECT, effectId);
    paint();
  }

  function replay() {
    revealed = false;
    if (surface) effect.reset(surface);
    notice("");
    paint();
    kick();
  }

  canvas.addEventListener(
    "pointerdown",
    (ev) => {
      if (isUi(ev.target) || ev.button) return;
      ev.preventDefault();
      if (activePointer !== null) return;
      activePointer = ev.pointerId;
      try {
        canvas.setPointerCapture(ev.pointerId);
      } catch {
        /* older browsers */
      }
      pokeUi(true);
      effect.pointerDown(pointFrom(ev));
      kick();
    },
    { passive: false }
  );
  canvas.addEventListener(
    "pointermove",
    (ev) => {
      if (ev.pointerId !== activePointer) return;
      ev.preventDefault();
      effect.pointerMove(pointFrom(ev));
      kick();
    },
    { passive: false }
  );
  const endPointer = (ev: PointerEvent) => {
    if (ev.pointerId !== activePointer) return;
    ev.preventDefault();
    effect.pointerUp(pointFrom(ev));
    activePointer = null;
    kick();
  };
  canvas.addEventListener("pointerup", endPointer, { passive: false });
  canvas.addEventListener("pointercancel", endPointer, { passive: false });

  const blockScroll = (ev: Event) => {
    if (isUi(ev.target)) return;
    ev.preventDefault();
  };
  document.addEventListener("touchmove", blockScroll, { passive: false });
  document.addEventListener("gesturestart", blockScroll, { passive: false });
  document.addEventListener("wheel", blockScroll, { passive: false });

  toolbar.addEventListener("pointerdown", () => pokeUi());
  menuBtn.addEventListener("click", () => {
    const hidden = !document.body.classList.contains("is-idle");
    pokeUi(hidden);
  });
  effectSelect.addEventListener("change", () => applyEffect(effectSelect.value));
  levelSelect.addEventListener("change", () => void applyLevel(levelSelect.value));
  brushInput.addEventListener("input", () => {
    if (surface) surface.brushCss = currentBrush();
    writePref(PREF_BRUSH, String(currentBrush()));
    pokeUi();
  });
  resetBtn.addEventListener("click", () => {
    replay();
    pokeUi();
  });
  fsBtn.addEventListener("click", () => void toggleFullscreen());

  const onResize = () => layout(false);
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", onResize);
  window.visualViewport?.addEventListener("resize", onResize);
  window.visualViewport?.addEventListener("scroll", onResize);
  document.addEventListener("fullscreenchange", () => {
    fsBtn.textContent = t(isFullscreen() ? "exitFullscreen" : "fullscreen");
    layout(false);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) running = false;
    else kick();
  });
  matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", (ev) => {
    reducedMotion = ev.matches;
    if (surface) surface.reducedMotion = reducedMotion;
  });
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", (ev) => {
    if (!document.documentElement.dataset.themeLocked) {
      document.documentElement.dataset.theme = ev.matches ? "light" : "dark";
    }
  });
  document.documentElement.dataset.theme = matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";

  await host.connect();
  const [savedEffect, savedLevel, savedBrush] = await Promise.all([
    readPref(PREF_EFFECT),
    readPref(PREF_LEVEL),
    readPref(PREF_BRUSH),
  ]);
  if (savedEffect && isEffectId(savedEffect)) effectId = savedEffect;
  if (savedLevel) level = levelById(savedLevel);
  if (savedBrush && Number(savedBrush)) brushInput.value = savedBrush;
  effect = createEffect(effectId);

  localize();
  pokeUi();
  try {
    await loadLevelImages(level);
    layout(true);
  } catch (error) {
    console.warn(error);
    notice(t("loadError"));
  }
  await host.rendered();
  kick();

  return {
    setTheme(mode: "light" | "dark", reduced?: boolean, lock = true) {
      document.documentElement.dataset.theme = mode;
      if (lock) document.documentElement.dataset.themeLocked = "1";
      if (reduced !== undefined) {
        reducedMotion = reduced;
        if (surface) surface.reducedMotion = reduced;
      }
      if (localeReady) localize();
    },
    notice,
    localize,
  };
}
