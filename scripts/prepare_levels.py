#!/usr/bin/env python3
"""Scan public/levels/<id>/{top,bottom}.*, write thumbs and levels.json."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
LEVELS_DIR = ROOT / "public" / "levels"
MANIFEST_PATH = ROOT / "manifest.json"
CATALOG_NAME = "levels.json"
ID_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,62}$")
IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".webp")
THUMB_SIZE = (360, 480)
THUMB_QUALITY = 78
MAX_RECOMMENDED_BYTES = 1_500_000


def find_image(folder: Path, stem: str) -> Path | None:
    for ext in IMAGE_EXTS:
        path = folder / f"{stem}{ext}"
        if path.is_file():
            return path
    return None


def rel(path: Path) -> str:
    return path.relative_to(LEVELS_DIR.parent).as_posix()


def cover_thumb(src: Path, dest: Path) -> None:
    im = Image.open(src)
    im = im.convert("RGB")
    # Honor EXIF orientation
    try:
        im = ImageOps_exif(im)
    except Exception:
        pass
    tw, th = THUMB_SIZE
    ir, cr = im.width / im.height, tw / th
    if ir > cr:
        nh = th
        nw = int(th * ir)
        resized = im.resize((nw, nh), Image.Resampling.LANCZOS)
        left = (nw - tw) // 2
        cropped = resized.crop((left, 0, left + tw, th))
    else:
        nw = tw
        nh = int(tw / ir)
        resized = im.resize((nw, nh), Image.Resampling.LANCZOS)
        top = (nh - th) // 2
        cropped = resized.crop((0, top, tw, top + th))
    dest.parent.mkdir(parents=True, exist_ok=True)
    cropped.save(dest, "JPEG", quality=THUMB_QUALITY, optimize=True, subsampling=2)


def ImageOps_exif(im: Image.Image) -> Image.Image:
    from PIL import ImageOps
    return ImageOps.exif_transpose(im) or im


def load_meta(folder: Path) -> dict:
    path = folder / "meta.json"
    if not path.is_file():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise SystemExit(f"{path} must be a JSON object")
    return data


def collect() -> list[dict]:
    if not LEVELS_DIR.is_dir():
        raise SystemExit(f"Missing {LEVELS_DIR}")
    entries: list[dict] = []
    warnings: list[str] = []
    for folder in sorted(p for p in LEVELS_DIR.iterdir() if p.is_dir()):
        if not ID_RE.match(folder.name):
            warnings.append(f"skip {folder.name}: id must match {ID_RE.pattern}")
            continue
        top = find_image(folder, "top")
        bottom = find_image(folder, "bottom")
        if not top or not bottom:
            warnings.append(f"skip {folder.name}: need top.(jpg|png|webp) and bottom.(jpg|png|webp)")
            continue
        for label, path in (("top", top), ("bottom", bottom)):
            size = path.stat().st_size
            if size > MAX_RECOMMENDED_BYTES:
                warnings.append(
                    f"warn {folder.name}/{path.name}: {size / 1024:.0f} KB exceeds recommended 1.5 MB"
                )
        meta = load_meta(folder)
        title = str(meta.get("title") or folder.name)
        titles = meta.get("titles") if isinstance(meta.get("titles"), dict) else {}
        titles = {str(k): str(v) for k, v in titles.items()}
        if "zh_CN" not in titles:
            titles["zh_CN"] = title
        default_effect = meta.get("defaultEffect")
        if default_effect is not None:
            default_effect = str(default_effect)
        order = meta.get("order")
        order_n = int(order) if isinstance(order, int) else 1000
        thumb = folder / "thumb.jpg"
        cover_thumb(top, thumb)
        entry = {
            "id": folder.name,
            "title": title,
            "titles": titles,
            "top": rel(top),
            "bottom": rel(bottom),
            "thumb": rel(thumb),
            "order": order_n,
        }
        if default_effect:
            entry["defaultEffect"] = default_effect
        entries.append(entry)
        print(f"  {folder.name}: {rel(top)} + {rel(bottom)} -> {rel(thumb)} ({thumb.stat().st_size} bytes)")
    for warning in warnings:
        print(warning, file=sys.stderr)
    entries.sort(key=lambda item: (item["order"], item["id"]))
    for item in entries:
        item.pop("order", None)
    if not entries:
        raise SystemExit("No levels found under public/levels/<id>/")
    return entries


def write_catalog(entries: list[dict]) -> Path:
    catalog = {"format": 1, "levels": entries}
    path = LEVELS_DIR / CATALOG_NAME
    path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def update_manifest(entries: list[dict]) -> None:
    assets = [f"levels/{CATALOG_NAME}"]
    for item in entries:
        for key in ("top", "bottom", "thumb"):
            assets.append(item[key])
    # unique, stable
    seen: set[str] = set()
    unique = []
    for path in assets:
        if path not in seen:
            seen.add(path)
            unique.append(path)
    if MANIFEST_PATH.is_file():
        manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        manifest["assets"] = unique
        MANIFEST_PATH.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"updated {MANIFEST_PATH.name} with {len(unique)} assets")


def main() -> None:
    print("Preparing levels…")
    entries = collect()
    catalog = write_catalog(entries)
    update_manifest(entries)
    print(f"wrote {catalog} ({len(entries)} levels)")


if __name__ == "__main__":
    main()
