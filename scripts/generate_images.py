#!/usr/bin/env python3
"""Generate built-in level art and the app icon (no external image downloads)."""

from __future__ import annotations

import math
import os
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public" / "images"
ICON = ROOT / "public" / "icon.png"
W, H = 1200, 1600
RNG = np.random.default_rng(20261110)

FONT_PATHS = [
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc",
]


def font(size: int, index: int = 0) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    for path in FONT_PATHS:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size=size, index=index)
            except OSError:
                continue
    return ImageFont.load_default()


def lerp(a, b, t):
    return a + (b - a) * t


def lerp_rgb(c1, c2, t):
    return tuple(int(lerp(a, b, t)) for a, b in zip(c1, c2))


def gradient(size, top_color, bottom_color, vertical=True, mid=None, mid_at=0.5):
    w, h = size
    arr = np.zeros((h, w, 3), dtype=np.float32)
    if vertical:
        t = np.linspace(0, 1, h, dtype=np.float32)[:, None]
    else:
        t = np.linspace(0, 1, w, dtype=np.float32)[None, :]
    if mid is None:
        colors = np.array(top_color, dtype=np.float32) * (1 - t) + np.array(bottom_color, dtype=np.float32) * t
    else:
        colors = np.empty(t.shape + (3,), dtype=np.float32)
        m = mid_at
        low = t <= m
        # avoid div0
        t1 = np.clip(t / max(m, 1e-6), 0, 1)
        t2 = np.clip((t - m) / max(1 - m, 1e-6), 0, 1)
        c0 = np.array(top_color, dtype=np.float32)
        c1 = np.array(mid, dtype=np.float32)
        c2 = np.array(bottom_color, dtype=np.float32)
        colors = c0 * (1 - t1) + c1 * t1
        colors2 = c1 * (1 - t2) + c2 * t2
        mask = (t > m)
        colors = np.where(mask[..., None] if colors.ndim == 3 else mask, colors2, colors)
    if colors.ndim == 2:
        colors = np.broadcast_to(colors[:, None, :], (h, w, 3)) if vertical else np.broadcast_to(colors[None, :, :], (h, w, 3))
    arr[:, :, :3] = colors
    return Image.fromarray(arr.astype(np.uint8), "RGB")


def value_noise(w, h, grid, rng, octaves=4):
    total = np.zeros((h, w), dtype=np.float32)
    amp = 1.0
    norm = 0.0
    gw, gh = grid
    for _ in range(octaves):
        gw = max(2, gw)
        gh = max(2, gh)
        raw = rng.random((gh, gw)).astype(np.float32)
        # bilinear upsample
        ys = np.linspace(0, gh - 1, h)
        xs = np.linspace(0, gw - 1, w)
        y0 = np.floor(ys).astype(np.int32)
        x0 = np.floor(xs).astype(np.int32)
        y1 = np.clip(y0 + 1, 0, gh - 1)
        x1 = np.clip(x0 + 1, 0, gw - 1)
        fy = (ys - y0)[:, None]
        fx = (xs - x0)[None, :]
        y0b = np.clip(y0, 0, gh - 1)
        x0b = np.clip(x0, 0, gw - 1)
        n00 = raw[y0b][:, x0b]
        n10 = raw[y1][:, x0b]
        n01 = raw[y0b][:, x1]
        n11 = raw[y1][:, x1]
        n = n00 * (1 - fy) * (1 - fx) + n10 * fy * (1 - fx) + n01 * (1 - fy) * fx + n11 * fy * fx
        total += n * amp
        norm += amp
        amp *= 0.5
        gw = int(gw * 2)
        gh = int(gh * 2)
    return total / norm


def paper_texture(base: Image.Image, strength=18, grain=0.12, seed=0):
    rng = np.random.default_rng(seed)
    w, h = base.size
    n = value_noise(w, h, (12, 16), rng, octaves=5)
    grain_n = rng.random((h, w)).astype(np.float32)
    arr = np.asarray(base).astype(np.float32)
    if arr.ndim == 2:
        arr = np.stack([arr] * 3, axis=2)
    shade = (n - 0.5) * strength + (grain_n - 0.5) * (strength * grain)
    # faint fibers
    for _ in range(5):
        angle = float(rng.uniform(0, math.pi))
        yy, xx = np.mgrid[0:h, 0:w]
        proj = xx * math.cos(angle) + yy * math.sin(angle)
        fibers = np.sin(proj / rng.uniform(3, 9)) * rng.uniform(2, 5)
        shade += fibers * 0.15
    arr[..., :3] = np.clip(arr[..., :3] + shade[..., None], 0, 255)
    mode = "RGBA" if arr.shape[2] == 4 else "RGB"
    return Image.fromarray(arr.astype(np.uint8), mode)


def vignette(img: Image.Image, amount=0.35, radius=0.7):
    w, h = img.size
    yy, xx = np.mgrid[0:h, 0:w]
    cx, cy = w / 2, h / 2
    r = np.sqrt(((xx - cx) / (w * radius)) ** 2 + ((cy - yy) / (h * radius)) ** 2)
    factor = np.clip(1 - amount * np.clip(r - 0.55, 0, 1) ** 1.4, 0.55, 1)
    arr = np.asarray(img).astype(np.float32)
    arr[..., :3] *= factor[..., None]
    return Image.fromarray(arr.astype(np.uint8), img.mode)


def add_sun(draw, cx, cy, radius, color, glow_layers=8):
    for i in range(glow_layers, 0, -1):
        t = i / glow_layers
        r = int(radius * (1 + t * 3.2))
        a = int(40 * (1 - t))
        col = color + (a,) if len(color) == 3 else color
        # draw on RGBA overlay later
        draw.ellipse((cx - r, cy - r, cx + r, cy + r), fill=col)


def circle(draw, xy, r, **kw):
    x, y = xy
    draw.ellipse((x - r, y - r, x + r, y + r), **kw)


def blob(draw, cx, cy, rx, ry, color, jitter=0.2, seed=1, n=14):
    rng = np.random.default_rng(seed)
    pts = []
    for i in range(n):
        a = (i / n) * math.tau
        j = 1 + float(rng.uniform(-jitter, jitter))
        pts.append((cx + math.cos(a) * rx * j, cy + math.sin(a) * ry * j))
    draw.polygon(pts, fill=color)


def draw_tree(img, cx, cy, scale, foliage, trunk, seed):
    rng = np.random.default_rng(seed)
    d = ImageDraw.Draw(img)
    th = int(90 * scale)
    tw = int(16 * scale)
    d.polygon(
        [
            (cx - tw * 0.4, cy),
            (cx + tw * 0.4, cy),
            (cx + tw * 0.7, cy + th),
            (cx - tw * 0.7, cy + th),
        ],
        fill=trunk,
    )
    # canopy clusters
    for i in range(7):
        ox = float(rng.uniform(-50, 50)) * scale
        oy = float(rng.uniform(-60, 20)) * scale
        rx = float(rng.uniform(34, 62)) * scale
        ry = float(rng.uniform(28, 50)) * scale
        col = lerp_rgb(foliage, (min(255, foliage[0] + 30), min(255, foliage[1] + 40), foliage[2] // 2), rng.random())
        blob(d, cx + ox, cy + oy, rx, ry, col, jitter=0.25, seed=seed + i, n=16)


def make_garden() -> Image.Image:
    sky = gradient((W, H), (255, 214, 150), (135, 186, 230), mid=(255, 232, 196), mid_at=0.28)
    arr = np.asarray(sky).astype(np.float32)
    # soft clouds
    rng = np.random.default_rng(11)
    cloud = value_noise(W, H, (8, 6), rng, 4)
    cloud = np.clip((cloud - 0.55) * 4, 0, 1)
    fade = np.clip(1 - (np.linspace(0, 1, H)[:, None] - 0.15) * 2.2, 0, 1)
    arr += np.stack([cloud * fade * 50] * 3, axis=2)
    img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    # sun
    sx, sy, sr = 860, 260, 70
    for i in range(10, 0, -1):
        t = i / 10
        r = int(sr * (1 + t * 4))
        od.ellipse((sx - r, sy - r, sx + r, sy + r), fill=(255, 220, 140, int(28 * (1 - t))))
    od.ellipse((sx - sr, sy - sr, sx + sr, sy + sr), fill=(255, 244, 210, 230))
    img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")

    d = ImageDraw.Draw(img)
    # distant hills
    rng = np.random.default_rng(3)
    def hill_poly(ybase, amp, color, seed, step=40):
        r = np.random.default_rng(seed)
        pts = [(0, H)]
        x = 0
        while x <= W:
            pts.append((x, ybase + math.sin(x / 180 + seed) * amp + float(r.uniform(-amp * 0.2, amp * 0.2))))
            x += step
        pts.append((W, ybase))
        pts.append((W, H))
        d.polygon(pts, fill=color)

    hill_poly(980, 70, (126, 168, 120), 4)
    hill_poly(1080, 90, (90, 140, 96), 5)
    hill_poly(1180, 80, (72, 122, 80), 6)

    # stone path
    path = []
    for i, y in enumerate(range(1220, H + 20, 10)):
        t = (y - 1220) / (H - 1220)
        cx = 600 + math.sin(t * 3) * 40
        half = 40 + t * 220
        path.append((cx, y, half))
    # fill path as quad strip
    pts_l = [(p[0] - p[2], p[1]) for p in path]
    pts_r = [(p[0] + p[2], p[1]) for p in path]
    d.polygon(pts_l + pts_r[::-1], fill=(186, 176, 158))
    # stepping stones
    for i, (cx, y, half) in enumerate(path[::3]):
        rw, rh = half * 0.55, 18 + (y - 1220) * 0.03
        col = (168, 160, 146) if i % 2 == 0 else (196, 188, 172)
        d.ellipse((cx - rw, y - rh, cx + rw, y + rh), fill=col, outline=(140, 132, 118))

    # grass blades near path
    rng = np.random.default_rng(9)
    for _ in range(900):
        x = int(rng.integers(0, W))
        y = int(rng.integers(1200, H))
        hgt = int(rng.integers(8, 28))
        shade = int(rng.integers(50, 110))
        d.line((x, y, x + int(rng.integers(-6, 6)), y - hgt), fill=(40, shade, 55), width=1)

    # trees
    trunks = (92, 62, 40)
    greens = [(46, 110, 62), (34, 96, 52), (70, 132, 74), (40, 88, 58)]
    positions = [
        (160, 1120, 1.6, 0),
        (300, 1180, 1.1, 1),
        (980, 1140, 1.8, 2),
        (1100, 1220, 1.0, 3),
        (80, 1280, 0.9, 4),
        (1040, 1300, 0.8, 5),
        (420, 1100, 0.7, 6),
        (760, 1080, 0.85, 7),
    ]
    for i, (x, y, sc, s) in enumerate(positions):
        draw_tree(img, x, y, sc, greens[s % len(greens)], trunks, 20 + s)

    # flowers
    petal_colors = [(232, 110, 140), (255, 170, 190), (255, 214, 110), (230, 90, 90), (255, 255, 255), (186, 120, 200)]
    rng = np.random.default_rng(21)
    for _ in range(180):
        x, y = int(rng.integers(40, W - 40)), int(rng.integers(1180, H - 20))
        # avoid very center of path
        col = petal_colors[int(rng.integers(0, len(petal_colors)))]
        r = int(rng.integers(5, 12))
        petals = int(rng.integers(5, 7))
        for p in range(petals):
            a = p / petals * math.tau + rng.random()
            px, py = x + math.cos(a) * r * 0.7, y + math.sin(a) * r * 0.7
            d.ellipse((px - r * 0.55, py - r * 0.4, px + r * 0.55, py + r * 0.4), fill=col)
        d.ellipse((x - 3, y - 3, x + 3, y + 3), fill=(255, 220, 80))

    # wooden bench
    bx, by = 780, 1320
    d.rectangle((bx, by, bx + 180, by + 14), fill=(122, 84, 50))
    d.rectangle((bx + 8, by + 14, bx + 20, by + 46), fill=(102, 70, 40))
    d.rectangle((bx + 160, by + 14, bx + 172, by + 46), fill=(102, 70, 40))
    d.rectangle((bx + 6, by - 28, bx + 18, by), fill=(112, 76, 46))
    d.rectangle((bx + 162, by - 28, bx + 174, by), fill=(112, 76, 46))
    d.rectangle((bx + 6, by - 32, bx + 174, by - 20), fill=(132, 92, 56))

    # lantern
    lx, ly = 430, 1280
    d.rectangle((lx + 14, ly - 70, lx + 22, ly + 10), fill=(90, 70, 48))
    d.polygon([(lx, ly - 20), (lx + 36, ly - 20), (lx + 30, ly + 16), (lx + 6, ly + 16)], fill=(210, 90, 60))
    d.polygon([(lx + 2, ly - 28), (lx + 34, ly - 28), (lx + 28, ly - 16), (lx + 8, ly - 16)], fill=(140, 50, 40))
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse((lx - 30, ly - 40, lx + 66, ly + 30), fill=(255, 160, 60, 50))
    img = Image.alpha_composite(img.convert("RGBA"), glow).convert("RGB")

    img = paper_texture(img, strength=8, grain=0.2, seed=2)
    return vignette(img, 0.25, 0.85)


def make_fog_window() -> Image.Image:
    # frosted pane with muntins and droplets — concealing layer
    base = gradient((W, H), (196, 210, 220), (168, 186, 198), mid=(210, 220, 226), mid_at=0.4)
    n = value_noise(W, H, (10, 14), np.random.default_rng(7), 5)
    arr = np.asarray(base).astype(np.float32)
    arr += (n[..., None] - 0.5) * 28
    # heavier frost toward edges
    yy, xx = np.mgrid[0:H, 0:W]
    edge = np.clip(
        1.15 - 1.6 * np.minimum(np.minimum(xx, W - xx) / (W * 0.5), np.minimum(yy, H - yy) / (H * 0.5)),
        0,
        1,
    )
    frost = 18 + edge * 40
    arr += frost[..., None]
    arr = np.clip(arr, 0, 255)
    img = Image.fromarray(arr.astype(np.uint8), "RGB")
    img = img.filter(ImageFilter.GaussianBlur(radius=1.2))

    # condensation streaks
    d = ImageDraw.Draw(img, "RGBA")
    rng = np.random.default_rng(13)
    frost_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    fd = ImageDraw.Draw(frost_layer)
    for _ in range(80):
        x = int(rng.integers(40, W - 40))
        y = int(rng.integers(40, H - 80))
        length = int(rng.integers(30, 220))
        w = int(rng.integers(2, 5))
        fd.line((x, y, x + int(rng.integers(-8, 8)), y + length), fill=(255, 255, 255, int(rng.integers(20, 55))), width=w)
    frost_layer = frost_layer.filter(ImageFilter.GaussianBlur(2))
    img = Image.alpha_composite(img.convert("RGBA"), frost_layer)

    # droplets
    drop_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    dd = ImageDraw.Draw(drop_layer)
    for i in range(260):
        x, y = int(rng.integers(30, W - 30)), int(rng.integers(30, H - 30))
        rx, ry = int(rng.integers(3, 11)), int(rng.integers(4, 16))
        dd.ellipse((x - rx, y - ry, x + rx, y + ry), fill=(226, 236, 242, int(rng.integers(70, 140))), outline=(255, 255, 255, 80))
        # highlight
        dd.ellipse((x - rx * 0.4, y - ry * 0.6, x - rx * 0.05, y - ry * 0.15), fill=(255, 255, 255, 160))
    img = Image.alpha_composite(img, drop_layer)

    # window frame / muntins
    frame = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    fr = ImageDraw.Draw(frame)
    wood = (92, 68, 48, 255)
    wood_dk = (62, 44, 30, 255)
    margin = 48
    # outer frame
    fr.rectangle((0, 0, W, margin), fill=wood)
    fr.rectangle((0, H - margin - 20, W, H), fill=wood)
    fr.rectangle((0, 0, margin, H), fill=wood)
    fr.rectangle((W - margin, 0, W, H), fill=wood)
    # inner bevel
    fr.rectangle((margin - 8, margin - 8, W - margin + 8, margin), fill=wood_dk)
    fr.rectangle((margin - 8, H - margin - 20, W - margin + 8, H - margin - 12), fill=(130, 100, 72, 255))
    # muntins 2 vertical, 3 horizontal
    bars_v = [W // 3, 2 * W // 3]
    bars_h = [H // 4, H // 2, 3 * H // 4]
    for x in bars_v:
        fr.rectangle((x - 14, margin, x + 14, H - margin - 20), fill=wood)
        fr.rectangle((x - 3, margin, x + 3, H - margin - 20), fill=(160, 124, 90, 180))
    for y in bars_h:
        fr.rectangle((margin, y - 12, W - margin, y + 12), fill=wood)
        fr.rectangle((margin, y - 2, W - margin, y + 2), fill=(160, 124, 90, 180))
    # metal latch
    cx, cy = W // 2, H // 2
    fr.rounded_rectangle((cx - 22, cy - 36, cx + 22, cy + 36), 6, fill=(120, 122, 118, 255), outline=(60, 60, 58, 255))
    fr.ellipse((cx - 8, cy - 8, cx + 8, cy + 8), fill=(40, 40, 38, 255))
    img = Image.alpha_composite(img, frame)
    img = paper_texture(img.convert("RGB"), strength=6, grain=0.08, seed=8)
    return vignette(img, 0.18, 0.9)


def shared_skyline(seed=42):
    rng = np.random.default_rng(seed)
    buildings = []
    x = 0
    while x < W:
        bw = int(rng.integers(70, 160))
        bh = int(rng.integers(280, 780))
        roof = str(rng.choice(["flat", "flat", "peak", "step"]))
        antenna = bool(rng.random() < 0.35)
        buildings.append({"x": x, "w": bw, "h": bh, "roof": roof, "antenna": antenna, "seed": int(rng.integers(1, 10**6))})
        x += bw + int(rng.integers(-8, 18))
    return buildings


BUILDINGS = shared_skyline()


def draw_skyline(img, buildings, base_y, facade, window_on, window_off, edge, night=False, lit_ratio=0.35):
    d = ImageDraw.Draw(img)
    rng = np.random.default_rng(99)
    for b in buildings:
        x, bw, bh = b["x"], b["w"], b["h"]
        top = base_y - bh
        shade = tuple(max(0, c - int((x / W) * 12)) for c in facade)
        d.rectangle((x, top, x + bw, base_y), fill=shade)
        d.line((x, top, x, base_y), fill=edge)
        # roof
        if b["roof"] == "peak":
            d.polygon([(x, top), (x + bw / 2, top - 40), (x + bw, top)], fill=tuple(max(0, c - 10) for c in shade))
        elif b["roof"] == "step":
            d.rectangle((x + 10, top - 28, x + bw - 10, top), fill=tuple(max(0, c - 8) for c in shade))
        if b["antenna"]:
            d.line((x + bw * 0.7, top - (50 if b["roof"] == "peak" else 18), x + bw * 0.7, top - 90), fill=edge, width=2)

        # windows grid
        pad_x, pad_y = 10, 16
        ww, wh, gapx, gapy = 10, 14, 8, 12
        coln = max(1, (bw - pad_x * 2) // (ww + gapx))
        rown = max(1, (bh - pad_y * 2) // (wh + gapy))
        wr = np.random.default_rng(b["seed"])
        for r in range(rown):
            for c in range(coln):
                wx = x + pad_x + c * (ww + gapx)
                wy = top + pad_y + r * (wh + gapy)
                on = wr.random() < (lit_ratio if night else 0.12)
                if night:
                    col = window_on if on else window_off
                else:
                    # daytime windows: mostly reflective, a few warm
                    col = window_on if wr.random() < 0.22 else window_off
                d.rectangle((wx, wy, wx + ww, wy + wh), fill=col)


def make_sunrise_city() -> Image.Image:
    sky = gradient((W, H), (255, 180, 110), (255, 236, 196), mid=(255, 120, 130), mid_at=0.18)
    # deeper top blue-violet remnant
    top = gradient((W, H), (88, 80, 140), (255, 180, 110), mid=(255, 130, 120), mid_at=0.22)
    img = top
    # sun
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    sx, sy, sr = W // 2, 520, 110
    for i in range(12, 0, -1):
        t = i / 12
        r = int(sr * (1 + t * 5))
        od.ellipse((sx - r, sy - r, sx + r, sy + r), fill=(255, 200, 120, int(22 * (1 - t))))
    od.ellipse((sx - sr, sy - sr, sx + sr, sy + sr), fill=(255, 236, 200, 240))
    img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")

    # distant haze mountains
    d = ImageDraw.Draw(img)
    d.polygon([(0, 900), (200, 820), (400, 880), (700, 800), (1000, 860), (W, 820), (W, 1100), (0, 1100)], fill=(210, 140, 130))
    d.polygon([(0, 980), (300, 900), (560, 970), (860, 890), (W, 950), (W, 1100), (0, 1100)], fill=(200, 126, 118))

    water_top = 1180
    # buildings sit on waterfront
    draw_skyline(
        img,
        BUILDINGS,
        water_top,
        facade=(164, 108, 98),
        window_on=(255, 220, 150),
        window_off=(120, 150, 170),
        edge=(110, 70, 66),
        night=False,
    )

    # river
    river = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    rd = ImageDraw.Draw(river)
    rd.rectangle((0, water_top, W, H), fill=(255, 160, 110, 255))
    # reflection: flip lower building band
    band = img.crop((0, water_top - 400, W, water_top)).transpose(Image.FLIP_TOP_BOTTOM)
    band = ImageEnhance.Brightness(band).enhance(0.7)
    band = ImageEnhance.Color(band).enhance(0.8)
    band = band.filter(ImageFilter.GaussianBlur(3))
    img.paste(band, (0, water_top))
    # ripples
    arr = np.asarray(img).astype(np.float32)
    yy = np.arange(H)[:, None]
    ripple = np.sin((yy - water_top) / 8.0) * 6
    # just overlay light lines
    img = Image.fromarray(arr.astype(np.uint8), "RGB")
    d = ImageDraw.Draw(img, "RGBA")
    for i in range(28):
        y = water_top + 12 + i * 16
        a = 50 - i
        if a > 0:
            d.line((0, y, W, y + int(math.sin(i) * 4)), fill=(255, 220, 180, a), width=1)
    # water tint
    water = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(water).rectangle((0, water_top, W, H), fill=(255, 120, 80, 40))
    img = Image.alpha_composite(img.convert("RGBA"), water).convert("RGB")

    # a few boats
    d = ImageDraw.Draw(img)
    d.polygon([(200, 1280), (250, 1268), (310, 1280), (250, 1290)], fill=(90, 50, 40))
    d.polygon([(800, 1360), (860, 1348), (930, 1362), (860, 1374)], fill=(80, 44, 36))

    img = paper_texture(img, strength=6, grain=0.1, seed=31)
    return vignette(img, 0.22, 0.8)


def make_night_city() -> Image.Image:
    sky = gradient((W, H), (8, 10, 28), (28, 30, 60), mid=(16, 18, 44), mid_at=0.4)
    arr = np.asarray(sky).astype(np.float32)
    rng = np.random.default_rng(5)
    # stars
    for _ in range(250):
        x, y = int(rng.integers(0, W)), int(rng.integers(0, 900))
        b = float(rng.uniform(120, 255))
        r = int(rng.integers(1, 2))
        arr[max(0, y - r) : y + r + 1, max(0, x - r) : x + r + 1] = (b, b, min(255, b + 20))
    img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")
    # faint moon
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    mx, my, mr = 260, 240, 48
    for i in range(8, 0, -1):
        t = i / 8
        r = int(mr * (1 + t * 3))
        od.ellipse((mx - r, my - r, mx + r, my + r), fill=(180, 200, 255, int(16 * (1 - t))))
    od.ellipse((mx - mr, my - mr, mx + mr, my + mr), fill=(230, 236, 255, 200))
    od.ellipse((mx - mr + 20, my - mr - 6, mx + mr + 20, my + mr - 6), fill=(8, 10, 28, 230))  # crescent-ish
    img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")

    water_top = 1180
    d = ImageDraw.Draw(img)
    d.polygon([(0, 960), (220, 880), (500, 940), (800, 860), (W, 920), (W, 1180), (0, 1180)], fill=(16, 20, 36))

    draw_skyline(
        img,
        BUILDINGS,
        water_top,
        facade=(22, 24, 40),
        window_on=(255, 214, 130),
        window_off=(14, 16, 28),
        edge=(8, 8, 16),
        night=True,
        lit_ratio=0.55,
    )

    # rain streaks
    rain = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    rd = ImageDraw.Draw(rain)
    rng = np.random.default_rng(77)
    for _ in range(500):
        x, y = int(rng.integers(0, W)), int(rng.integers(0, H))
        length = int(rng.integers(16, 46))
        rd.line((x, y, x + 3, y + length), fill=(180, 200, 220, int(rng.integers(28, 70))), width=1)
    img = Image.alpha_composite(img.convert("RGBA"), rain).convert("RGB")

    # dark water reflections
    band = img.crop((0, water_top - 400, W, water_top)).transpose(Image.FLIP_TOP_BOTTOM)
    band = ImageEnhance.Brightness(band).enhance(0.45)
    band = band.filter(ImageFilter.GaussianBlur(4))
    img.paste(band, (0, water_top))
    water = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(water).rectangle((0, water_top, W, H), fill=(4, 10, 28, 80))
    img = Image.alpha_composite(img.convert("RGBA"), water).convert("RGB")

    # wet glass sheen (this is the covering layer)
    sheen = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(sheen)
    sd.polygon([(0, 0), (400, 0), (180, H), (0, H)], fill=(200, 220, 255, 18))
    img = Image.alpha_composite(img.convert("RGBA"), sheen).convert("RGB")
    img = paper_texture(img, strength=5, grain=0.08, seed=44)
    return vignette(img, 0.35, 0.75)


def make_postcard() -> Image.Image:
    # travel postcard of a coastal town
    sky = gradient((W, H), (110, 180, 230), (255, 244, 214), mid=(160, 210, 235), mid_at=0.35)
    img = sky
    d = ImageDraw.Draw(img)
    # sea
    d.rectangle((0, 900, W, H), fill=(64, 150, 180))
    sea = np.asarray(img).astype(np.float32)
    rng = np.random.default_rng(12)
    n = value_noise(W, H, (16, 6), rng, 4)
    yy = np.linspace(0, 1, H)[:, None]
    mask = np.clip((yy - 900 / H) * 8, 0, 1)
    sea[..., 0] += (n - 0.5) * 18 * mask
    sea[..., 1] += (n - 0.5) * 10 * mask
    sea[..., 2] += (n - 0.4) * 8 * mask
    # lighter near horizon
    horizon = np.clip(1 - np.abs(yy - 900 / H) * 18, 0, 1)
    near = (yy > 850 / H).astype(np.float32)
    sea += (horizon * near)[..., None] * np.array([30, 20, 10], dtype=np.float32)
    img = Image.fromarray(np.clip(sea, 0, 255).astype(np.uint8), "RGB")
    d = ImageDraw.Draw(img)
    # foam lines
    for i in range(18):
        y = 920 + i * 36
        d.arc((-200, y, W + 200, y + 40), 0, 180, fill=(220, 240, 245), width=2)

    # island cliffs / town
    d.polygon([(80, 900), (200, 760), (340, 820), (500, 700), (660, 800), (820, 680), (1040, 790), (1200, 900)], fill=(90, 150, 110))
    d.polygon([(80, 900), (260, 820), (480, 860), (700, 800), (960, 870), (1200, 900)], fill=(210, 186, 140))

    # little houses
    rng = np.random.default_rng(17)
    houses = [(180, 850), (250, 840), (400, 830), (520, 810), (610, 820), (740, 800), (880, 830), (980, 850)]
    colors = [(236, 232, 220), (240, 200, 180), (220, 230, 210), (245, 236, 200)]
    roofs = [(180, 70, 70), (90, 90, 100), (160, 80, 50), (70, 100, 90)]
    for i, (hx, hy) in enumerate(houses):
        hw, hh = 54, 44
        d.rectangle((hx, hy - hh, hx + hw, hy), fill=colors[i % 4])
        d.polygon([(hx - 6, hy - hh), (hx + hw / 2, hy - hh - 22), (hx + hw + 6, hy - hh)], fill=roofs[i % 4])
        d.rectangle((hx + 10, hy - 22, hx + 22, hy - 8), fill=(120, 180, 210))
        d.rectangle((hx + 32, hy - 22, hx + 44, hy - 8), fill=(120, 180, 210))

    # a lighthouse
    lx, ly = 820, 760
    d.rectangle((lx, ly - 140, lx + 28, ly), fill=(240, 236, 228))
    d.rectangle((lx - 6, ly - 158, lx + 34, ly - 140), fill=(200, 60, 60))
    d.polygon([(lx + 14, ly - 190), (lx - 8, ly - 158), (lx + 36, ly - 158)], fill=(230, 70, 70))
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse((lx - 30, ly - 200, lx + 60, ly - 120), fill=(255, 230, 140, 70))
    img = Image.alpha_composite(img.convert("RGBA"), glow).convert("RGB")

    # postcard border and stamp
    border = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    bd = ImageDraw.Draw(border)
    m = 36
    bd.rectangle((0, 0, W, H), outline=(248, 244, 230, 255), width=m)
    bd.rectangle((m - 8, m - 8, W - m + 8, H - m + 8), outline=(200, 80, 80, 220), width=6)
    # stamp
    sx, sy, sw, sh = W - 250, 70, 170, 200
    bd.rounded_rectangle((sx, sy, sx + sw, sy + sh), 4, fill=(236, 232, 220, 240), outline=(40, 40, 50, 255), width=4)
    # perforated edge
    for i in range(12):
        bd.ellipse((sx - 6, sy + 8 + i * 16, sx + 6, sy + 20 + i * 16), fill=(248, 244, 230, 255))
        bd.ellipse((sx + sw - 6, sy + 8 + i * 16, sx + sw + 6, sy + 20 + i * 16), fill=(248, 244, 230, 255))
    bd.rectangle((sx + 18, sy + 18, sx + sw - 18, sy + 120), fill=(80, 150, 190, 255))
    bd.polygon([(sx + 18, sy + 90), (sx + 60, sy + 50), (sx + 90, sy + 80), (sx + 120, sy + 44), (sx + sw - 18, sy + 100), (sx + sw - 18, sy + 120), (sx + 18, sy + 120)], fill=(230, 240, 230, 255))
    img = Image.alpha_composite(img.convert("RGBA"), border)
    # typography
    f = font(48, 0)
    fb = font(36, 0)
    td = ImageDraw.Draw(img)
    td.text((60, 70), "POST CARD", font=f, fill=(40, 50, 70, 230))
    td.text((64, 128), "COASTAL LIGHT  ·  海岸灯塔", font=fb, fill=(60, 70, 90, 200))
    img = paper_texture(img.convert("RGB"), strength=7, grain=0.12, seed=18)
    return vignette(img, 0.16, 0.9)


def make_envelope() -> Image.Image:
    kraft = gradient((W, H), (201, 166, 114), (168, 128, 82), mid=(186, 148, 98), mid_at=0.5)
    img = paper_texture(kraft, strength=22, grain=0.25, seed=5)
    # extra fibers
    d = ImageDraw.Draw(img, "RGBA")
    rng = np.random.default_rng(3)
    for _ in range(400):
        x, y = int(rng.integers(0, W)), int(rng.integers(0, H))
        d.line((x, y, x + int(rng.integers(8, 40)), y + int(rng.integers(-4, 4))), fill=(120, 90, 50, 30), width=1)

    # envelope flap (upper triangle)
    flap = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    fd = ImageDraw.Draw(flap)
    fd.polygon([(0, 0), (W, 0), (W / 2, 640)], fill=(186, 146, 96, 255))
    # flap inner shadow
    fd.polygon([(40, 40), (W - 40, 40), (W / 2, 600)], fill=(160, 120, 76, 40))
    # fold line highlight
    fd.line([(0, 0), (W / 2, 640), (W, 0)], fill=(120, 90, 55, 160), width=6)
    fd.line([(20, 20), (W / 2, 620), (W - 20, 20)], fill=(230, 200, 150, 70), width=3)
    img = Image.alpha_composite(img.convert("RGBA"), flap).convert("RGB")

    # side folds suggestion
    d = ImageDraw.Draw(img, "RGBA")
    d.line((0, 0, 80, H), fill=(110, 80, 45, 80), width=3)
    d.line((W, 0, W - 80, H), fill=(110, 80, 45, 80), width=3)

    # twine
    tw = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    td = ImageDraw.Draw(tw)
    # crossing strings
    td.line((0, 980, W, 1040), fill=(214, 196, 150, 255), width=10)
    td.line((0, 1000, W, 1060), fill=(160, 130, 90, 180), width=3)
    td.line((420, 0, 780, H), fill=(214, 196, 150, 255), width=10)
    td.line((440, 0, 800, H), fill=(160, 130, 90, 140), width=3)
    img = Image.alpha_composite(img.convert("RGBA"), tw).convert("RGB")

    # postage stamp top right
    d = ImageDraw.Draw(img, "RGBA")
    sx, sy, sw, sh = W - 280, 80, 200, 240
    d.rectangle((sx, sy, sx + sw, sy + sh), fill=(232, 220, 200, 255), outline=(60, 40, 30, 255), width=5)
    d.rectangle((sx + 16, sy + 16, sx + sw - 16, sy + 140), fill=(120, 92, 64, 255))
    d.polygon([(sx + 16, sy + 110), (sx + 70, sy + 50), (sx + 110, sy + 86), (sx + sw - 16, sy + 58), (sx + sw - 16, sy + 140), (sx + 16, sy + 140)], fill=(90, 130, 90, 255))
    d.ellipse((sx + 120, sy + 28, sx + 168, sy + 76), fill=(230, 180, 90, 255))
    fsmall = font(28)
    d.text((sx + 30, sy + 160), "邮  80", font=fsmall, fill=(60, 40, 30, 255))

    # address lines
    f = font(42)
    d.text((120, 860), "亲启", font=font(72), fill=(80, 50, 30, 200))
    for i, y in enumerate(range(980, 1280, 70)):
        d.line((120, y, 700, y), fill=(110, 80, 50, 100), width=2)

    # wax seal
    cx, cy, r = W // 2 + 30, 640, 110
    seal = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    sd = ImageDraw.Draw(seal)
    for i in range(8, 0, -1):
        t = i / 8
        sd.ellipse((cx - r * (0.85 + t * 0.25), cy - r * (0.85 + t * 0.25), cx + r * (0.85 + t * 0.25), cy + r * (0.85 + t * 0.25)), fill=(80, 0, 0, int(30 * (1 - t))))
    # scalloped edge
    pts = []
    for i in range(36):
        a = i / 36 * math.tau
        rr = r * (1.05 if i % 2 == 0 else 0.92)
        pts.append((cx + math.cos(a) * rr, cy + math.sin(a) * rr))
    sd.polygon(pts, fill=(152, 28, 36, 255))
    sd.ellipse((cx - r * 0.78, cy - r * 0.78, cx + r * 0.78, cy + r * 0.78), fill=(176, 36, 42, 255))
    # inner emblem
    sd.ellipse((cx - 44, cy - 44, cx + 44, cy + 44), outline=(220, 170, 90, 230), width=6)
    # a simple flower
    for i in range(6):
        a = i / 6 * math.tau - 0.3
        px, py = cx + math.cos(a) * 28, cy + math.sin(a) * 28
        sd.ellipse((px - 14, py - 14, px + 14, py + 14), fill=(220, 170, 90, 230))
    sd.ellipse((cx - 12, cy - 12, cx + 12, cy + 12), fill=(152, 28, 36, 255))
    img = Image.alpha_composite(img.convert("RGBA"), seal).convert("RGB")
    return vignette(img, 0.2, 0.85)


def make_icon() -> Image.Image:
    s = 512
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # background circle (will be cropped circular on the platform, but also used as favicon)
    d.ellipse((0, 0, s - 1, s - 1), fill=(40, 28, 22, 255))
    # bottom layer (warm photo)
    d.rounded_rectangle((96, 120, 420, 430), 28, fill=(255, 176, 110, 255))
    d.ellipse((200, 150, 300, 250), fill=(255, 220, 150, 255))
    d.polygon([(110, 360), (200, 260), (280, 340), (340, 250), (410, 370), (110, 400)], fill=(80, 140, 100, 255))
    # top layer, offset, torn
    top = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    td = ImageDraw.Draw(top)
    # torn rectangle from left, missing a bite on the right
    torn = [(86, 86), (400, 86)]
    # jagged right edge
    rng = np.random.default_rng(1)
    y = 86
    x = 400
    while y < 420:
        x = 300 + math.sin(y / 18) * 28 + float(rng.uniform(-10, 10))
        torn.append((x, y))
        y += 14
    torn += [(86, 426)]
    td.polygon(torn, fill=(201, 166, 114, 255), outline=(120, 90, 55, 255))
    # paper edge highlight
    img = Image.alpha_composite(img, top)
    d = ImageDraw.Draw(img)
    # character
    f = font(200, 0)
    # measure
    text = "揭"
    try:
        bbox = d.textbbox((0, 0), text, font=f)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        d.text(((s - tw) / 2 - bbox[0] - 30, (s - th) / 2 - bbox[1] + 10), text, font=f, fill=(80, 48, 28, 255))
    except Exception:
        pass
    return img


def save_jpeg(img: Image.Image, path: Path, quality=88):
    path.parent.mkdir(parents=True, exist_ok=True)
    rgb = img.convert("RGB")
    rgb.save(path, "JPEG", quality=quality, optimize=True, subsampling=1)
    print(f"wrote {path} ({path.stat().st_size / 1024:.1f} KB)")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    save_jpeg(make_fog_window(), OUT / "window-top.jpg")
    save_jpeg(make_garden(), OUT / "window-bottom.jpg")
    save_jpeg(make_night_city(), OUT / "city-top.jpg")
    save_jpeg(make_sunrise_city(), OUT / "city-bottom.jpg")
    save_jpeg(make_envelope(), OUT / "letter-top.jpg")
    save_jpeg(make_postcard(), OUT / "letter-bottom.jpg")
    ICON.parent.mkdir(parents=True, exist_ok=True)
    make_icon().save(ICON, "PNG", optimize=True)
    print(f"wrote {ICON} ({ICON.stat().st_size / 1024:.1f} KB)")


if __name__ == "__main__":
    main()
