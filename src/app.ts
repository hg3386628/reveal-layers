import { assetUrl, fitCover, loadImage, mimeOf } from "./assets.ts";
import {
  AUTO_REVEAL,
  createEffect,
  effectIds,
  isEffectId,
  type Effect,
  type EffectId,
  type Surface,
} from "./effects/index.ts";
import type { Host } from "./host.ts";
import {
  levelById,
  loadCatalog,
  nextLevel,
  randomLevel,
  titleOf,
  type Level,
} from "./levels.ts";

const PREF_EFFECT = "reveal-layers:effect";
const PREF_LEVEL = "reveal-layers:level";
const PREF_BRUSH = "reveal-layers:brush";
const PREF_COMPLETED = "reveal-layers:completed";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export async function startApp(host: Host) {
  const canvas = $<HTMLCanvasElement>("stage");
  const ctx = canvas.getContext("2d")!;
  const toolbar = $<HTMLDivElement>("toolbar");
  const effectSelect = $<HTMLSelectElement>("effect");
  const brushInput = $<HTMLInputElement>("brush");
  const brushField = $<HTMLLabelElement>("brush-field");
  const resetBtn = $<HTMLButtonElement>("reset");
  const fsBtn = $<HTMLButtonElement>("fullscreen");
  const menuBtn = $<HTMLButtonElement>("menu-toggle");
  const hintTitle = $<HTMLElement>("hint-title");
  const hintCopy = $<HTMLElement>("hint-copy");
  const noticeEl = $<HTMLElement>("notice");
  const grid = $<HTMLElement>("level-grid");
  const progressEl = $<HTMLElement>("select-progress");
  const completeEl = $<HTMLElement>("complete");
  const nextBtn = $<HTMLButtonElement>("next-level");

  let localeReady = false;
  let reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let effectId: EffectId = "scratch";
  let levels: Level[] = [];
  let level: Level | null = null;
  let effect: Effect = createEffect(effectId);
  let surface: Surface | null = null;
  let topSrc: (CanvasImageSource & { width: number; height: number }) | null = null;
  let bottomSrc: (CanvasImageSource & { width: number; height: number }) | null = null;
  const imageCache = new Map<string, CanvasImageSource & { width: number; height: number }>();
  const thumbUrls = new Map<string, string>();
  const completed = new Set<string>();
  const prefetching = new Set<string>();
  let lastPlayed: string | null = null;
  let mode: "select" | "play" = "select";
  let revealed = false;
  let running = false;
  let lastTs = 0;
  let activePointer: number | null = null;
  let idleTimer = 0;
  let noticeTimer = 0;
  let starting = true;
  let completeTimer = 0;

  const t = (key: string, values?: object) => host.t(key, values);

  function localize() {
    document.querySelectorAll<HTMLElement>("[data-text]").forEach((node) => {
      node.textContent = t(node.dataset.text!);
    });
    canvas.setAttribute("aria-label", t("board"));
    if (level) hintTitle.textContent = titleOf(level, host.locale);
    const hintKey =
      effectId === "peel" ? "hintPeel" : effectId === "shatter" ? "hintShatter" : "hint";
    hintCopy.textContent = t(hintKey);
    fillSelect(effectSelect, effectIds, (id) => t(id), effectId);
    brushInput.value = String(Math.round(surface?.brushCss ?? (Number(brushInput.value) || 42)));
    brushField.hidden = !effect.usesBrush;
    const fsLabel = t(isFullscreen() ? "exitFullscreen" : "fullscreen");
    fsBtn.textContent = fsLabel;
    const selectFs = document.getElementById("select-fullscreen");
    if (selectFs) selectFs.textContent = fsLabel;
    document.title = t("title");
    localeReady = true;
    if (mode === "select") renderGrid();
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
    return (
      target instanceof Element &&
      Boolean(target.closest(".toolbar, .fab, .select, .complete, select, input, button"))
    );
  }

  function pokeUi(hide = false) {
    if (mode !== "play") return;
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
      localize();
      return;
    }
    try {
      if (!wantOn) {
        if (document.fullscreenElement) await document.exitFullscreen();
        else if (doc.webkitFullscreenElement) await doc.webkitExitFullscreen?.();
        document.body.classList.remove("is-immersive");
        localize();
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
    if (mode === "play") pokeUi(wantOn);
    localize();
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

  function persistCompleted() {
    writePref(PREF_COMPLETED, JSON.stringify([...completed]));
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

  function evictCache(keep: Level[]) {
    const allowed = new Set(keep.flatMap((item) => [item.top, item.bottom]));
    for (const key of [...imageCache.keys()]) {
      if (!allowed.has(key)) imageCache.delete(key);
    }
  }

  function prefetch(next: Level | undefined) {
    if (!next || prefetching.has(next.id)) return;
    prefetching.add(next.id);
    void Promise.all([loadImage(next.top, host), loadImage(next.bottom, host)])
      .then(([top, bottom]) => {
        imageCache.set(next.top, top);
        imageCache.set(next.bottom, bottom);
      })
      .catch((error) => console.warn(error))
      .finally(() => prefetching.delete(next.id));
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
    if (mode !== "play") return;
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
    const resized = !surface || surface.width !== next.width || surface.height !== next.height;
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
    if (mode !== "play" || !surface) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(surface.bottom, 0, 0);
    effect.draw(ctx, surface);
  }

  function kick() {
    if (mode !== "play" || running || document.hidden) return;
    running = true;
    lastTs = performance.now();
    requestAnimationFrame(frame);
  }

  function markComplete() {
    if (!level || revealed) return;
    revealed = true;
    effect.forceReveal();
    completed.add(level.id);
    persistCompleted();
    window.clearTimeout(completeTimer);
    completeTimer = window.setTimeout(() => {
      completeEl.hidden = false;
      nextBtn.hidden = levels.length < 2;
    }, reducedMotion ? 0 : 480);
  }

  function frame(ts: number) {
    if (!running || mode !== "play") return;
    const dt = Math.min(0.05, (ts - lastTs) / 1000 || 0.016);
    lastTs = ts;
    const anim = effect.update(dt);
    if (!revealed && effect.clearedRatio() >= AUTO_REVEAL) markComplete();
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

  function showSelect() {
    mode = "select";
    running = false;
    revealed = false;
    window.clearTimeout(completeTimer);
    completeEl.hidden = true;
    document.body.classList.add("is-select");
    document.body.classList.remove("is-play", "is-idle");
    menuBtn.setAttribute("aria-expanded", "false");
    localize();
    renderGrid();
    const current = lastPlayed
      ? grid.querySelector(`.level-card[data-id="${CSS.escape(lastPlayed)}"]`)
      : null;
    current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  async function enterLevel(id: string, persist = true) {
    if (!levels.length) return;
    const next = levelById(levels, id);
    notice(t("loading"));
    try {
      await loadLevelImages(next);
    } catch (error) {
      console.warn(error);
      notice(t("loadError"));
      return;
    }
    const upcoming = nextLevel(levels, next);
    evictCache(upcoming && upcoming.id !== next.id ? [next, upcoming] : [next]);
    level = next;
    if (next.defaultEffect && isEffectId(next.defaultEffect)) {
      applyEffect(next.defaultEffect, false);
    }
    mode = "play";
    starting = true;
    revealed = false;
    window.clearTimeout(completeTimer);
    completeEl.hidden = true;
    document.body.classList.remove("is-select");
    document.body.classList.add("is-play");
    layout(true);
    localize();
    notice("");
    if (persist) {
      lastPlayed = next.id;
      writePref(PREF_LEVEL, next.id);
    }
    pokeUi();
    kick();
    prefetch(upcoming && upcoming.id !== next.id ? upcoming : undefined);
  }

  function applyEffect(id: string, persist = true) {
    const nextId: EffectId = isEffectId(id) ? id : "scratch";
    effect.dispose();
    effectId = nextId;
    effect = createEffect(effectId);
    revealed = false;
    window.clearTimeout(completeTimer);
    completeEl.hidden = true;
    if (surface && mode === "play") effect.reset(surface);
    brushField.hidden = !effect.usesBrush;
    effectSelect.value = effectId;
    if (localeReady) {
      const hintKey =
        effectId === "peel" ? "hintPeel" : effectId === "shatter" ? "hintShatter" : "hint";
      hintCopy.textContent = t(hintKey);
    }
    if (persist) writePref(PREF_EFFECT, effectId);
    paint();
  }

  function replay() {
    revealed = false;
    window.clearTimeout(completeTimer);
    completeEl.hidden = true;
    if (surface) effect.reset(surface);
    notice("");
    paint();
    pokeUi();
    kick();
  }

  async function thumbSrc(path: string) {
    const cached = thumbUrls.get(path);
    if (cached) return cached;
    const bytes = await host.readAsset(path);
    if (bytes) {
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      const url = URL.createObjectURL(new Blob([copy], { type: mimeOf(path) }));
      thumbUrls.set(path, url);
      return url;
    }
    return assetUrl(path);
  }

  function bindThumb(img: HTMLImageElement, path: string) {
    const cached = thumbUrls.get(path);
    if (cached) {
      img.src = cached;
      return;
    }
    const load = () => {
      void thumbSrc(path)
        .then((url) => {
          img.src = url;
        })
        .catch(() => {
          img.src = assetUrl(path);
        });
    };
    if (typeof IntersectionObserver !== "function") {
      load();
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        io.disconnect();
        load();
      },
      { root: document.querySelector(".select"), rootMargin: "240px" }
    );
    io.observe(img);
  }

  function renderGrid() {
    progressEl.textContent = t("progress", { done: completed.size, total: levels.length });
    const existing = new Map(
      [...grid.querySelectorAll<HTMLButtonElement>(".level-card")].map((node) => [
        node.dataset.id,
        node,
      ])
    );
    grid.textContent = "";
    for (const item of levels) {
      const card = existing.get(item.id) ?? document.createElement("button");
      card.type = "button";
      card.className = "level-card";
      card.dataset.id = item.id;
      card.setAttribute("role", "listitem");
      const name = titleOf(item, host.locale);
      const done = completed.has(item.id);
      card.classList.toggle("is-done", done);
      card.classList.toggle("is-current", item.id === lastPlayed);
      card.setAttribute("aria-label", done ? `${name}，${t("completed")}` : name);
      if (!card.hasChildNodes()) {
        const img = document.createElement("img");
        img.className = "level-card__thumb";
        img.alt = "";
        img.width = 360;
        img.height = 480;
        img.loading = "lazy";
        img.decoding = "async";
        const meta = document.createElement("span");
        meta.className = "level-card__meta";
        const title = document.createElement("span");
        title.className = "level-card__title";
        const mark = document.createElement("span");
        mark.className = "level-card__done";
        mark.setAttribute("aria-hidden", "true");
        mark.textContent = "✓";
        meta.append(title, mark);
        card.append(img, meta);
        bindThumb(img, item.thumb);
      }
      const title = card.querySelector(".level-card__title");
      if (title) title.textContent = name;
      grid.append(card);
    }
  }

  canvas.addEventListener(
    "pointerdown",
    (ev) => {
      if (mode !== "play" || isUi(ev.target) || ev.button) return;
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
      if (mode !== "play" || ev.pointerId !== activePointer) return;
      ev.preventDefault();
      effect.pointerMove(pointFrom(ev));
      kick();
    },
    { passive: false }
  );
  const endPointer = (ev: PointerEvent) => {
    if (mode !== "play" || ev.pointerId !== activePointer) return;
    ev.preventDefault();
    effect.pointerUp(pointFrom(ev));
    activePointer = null;
    kick();
  };
  canvas.addEventListener("pointerup", endPointer, { passive: false });
  canvas.addEventListener("pointercancel", endPointer, { passive: false });

  const blockScroll = (ev: Event) => {
    if (mode !== "play" || isUi(ev.target)) return;
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
  brushInput.addEventListener("input", () => {
    if (surface) surface.brushCss = currentBrush();
    writePref(PREF_BRUSH, String(currentBrush()));
    pokeUi();
  });
  resetBtn.addEventListener("click", () => {
    replay();
  });
  fsBtn.addEventListener("click", () => void toggleFullscreen());
  $("select-fullscreen").addEventListener("click", () => void toggleFullscreen());
  $("open-select").addEventListener("click", () => showSelect());
  $("back-select").addEventListener("click", () => showSelect());
  $("next-level").addEventListener("click", () => {
    if (!level) return;
    void enterLevel(nextLevel(levels, level).id);
  });
  $("random-level").addEventListener("click", () => {
    const pick = randomLevel(levels, level ?? undefined);
    if (pick) void enterLevel(pick.id);
  });
  $("select-random").addEventListener("click", () => {
    const pick = randomLevel(levels);
    if (pick) void enterLevel(pick.id);
  });
  $("replay-complete").addEventListener("click", () => replay());
  grid.addEventListener("click", (ev) => {
    const card = ev.target instanceof Element ? ev.target.closest<HTMLButtonElement>(".level-card") : null;
    if (card?.dataset.id) void enterLevel(card.dataset.id);
  });

  const onResize = () => layout(false);
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", onResize);
  window.visualViewport?.addEventListener("resize", onResize);
  window.visualViewport?.addEventListener("scroll", onResize);
  document.addEventListener("fullscreenchange", () => {
    localize();
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
  const [savedEffect, savedLevel, savedBrush, savedCompleted] = await Promise.all([
    readPref(PREF_EFFECT),
    readPref(PREF_LEVEL),
    readPref(PREF_BRUSH),
    readPref(PREF_COMPLETED),
  ]);
  if (savedLevel) lastPlayed = savedLevel;
  if (savedEffect && isEffectId(savedEffect)) effectId = savedEffect;
  if (savedBrush && Number(savedBrush)) brushInput.value = savedBrush;
  if (savedCompleted) {
    try {
      const parsed = JSON.parse(savedCompleted) as unknown;
      if (Array.isArray(parsed)) {
        for (const id of parsed) if (typeof id === "string") completed.add(id);
      }
    } catch {
      /* ignore broken save */
    }
  }
  effect = createEffect(effectId);

  try {
    levels = await loadCatalog(host);
  } catch (error) {
    console.warn(error);
    notice(t("loadError"));
  }

  document.body.classList.add("is-select");
  localize();
  showSelect();
  await host.rendered();

  return {
    setTheme(modeName: "light" | "dark", reduced?: boolean, lock = true) {
      document.documentElement.dataset.theme = modeName;
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
