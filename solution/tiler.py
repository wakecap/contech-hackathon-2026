"""Tile equirectangular panoramas into flat perspective views for VLMs.

Rohbau3D panoramas are 4096x2048 equirectangular renders of laser scans.
Feeding a raw equirect image to a VLM distorts everything near the poles, so
we reproject to cube faces and build a contact sheet.

Pure numpy + Pillow. No torch, no GPU. Works on Python 3.15.

Usage:
    python tiler.py --pano color.png --out tiles/ --size 768
    python tiler.py --selftest --out tiles_test/ --size 512
"""
from __future__ import annotations

import argparse
import json
import math
import time
from pathlib import Path

import numpy as np
from PIL import Image

# Cube face -> maps (u, v) in [-1, 1] to a 3D direction (x, y, z).
# Matches the usual equirect convention: lon = atan2(x, z), lat = asin(y).
FACES = {
    "front": lambda u, v: (u, -v, 1.0),
    "back": lambda u, v: (-u, -v, -1.0),
    "left": lambda u, v: (-1.0, -v, -u),
    "right": lambda u, v: (1.0, -v, u),
    "up": lambda u, v: (u, 1.0, -v),
    "down": lambda u, v: (u, -1.0, v),
}
FACE_ORDER = ["front", "right", "back", "left", "up", "down"]


def _directions(face: str, size: int):
    """Unit direction vectors for every pixel of one cube face."""
    step = (np.arange(size) + 0.5) / size * 2.0 - 1.0  # -1 .. 1
    u, v = np.meshgrid(step, step)  # u across width, v down height
    x, y, z = FACES[face](u, v)
    n = np.sqrt(x * x + y * y + z * z)
    return x / n, y / n, z / n


def equirect_to_faces(pano: Image.Image, size: int = 768) -> dict[str, Image.Image]:
    """Reproject an equirectangular panorama into six flat cube faces."""
    arr = np.asarray(pano.convert("RGB"), dtype=np.float32)
    h, w = arr.shape[:2]
    faces: dict[str, Image.Image] = {}

    for face in FACES:
        x, y, z = _directions(face, size)
        lon = np.arctan2(x, z)                  # -pi .. pi
        lat = np.arcsin(np.clip(y, -1.0, 1.0))  # -pi/2 .. pi/2

        # Bilinear sample (longitude wraps, latitude clamps).
        fu = (lon / (2 * math.pi) + 0.5) * w
        fv = (0.5 - lat / math.pi) * h
        u0 = np.floor(fu).astype(np.int64) % w
        v0 = np.clip(np.floor(fv).astype(np.int64), 0, h - 1)
        u1 = (u0 + 1) % w
        v1 = np.clip(v0 + 1, 0, h - 1)
        du = (fu - np.floor(fu))[..., None]
        dv = (fv - np.floor(fv))[..., None]

        a = arr[v0, u0]
        b = arr[v0, u1]
        c = arr[v1, u0]
        d = arr[v1, u1]
        top = a * (1 - du) + b * du
        bot = c * (1 - du) + d * du
        out = top * (1 - dv) + bot * dv

        faces[face] = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))
    return faces


def contact_sheet(faces: dict[str, Image.Image], cols: int = 3,
                  pad: int = 8, bg: tuple[int, int, int] = (24, 24, 24)) -> Image.Image:
    """Combine cube faces into a single grid image for a one-shot VLM call."""
    tiles = [faces[n] for n in FACE_ORDER if n in faces]
    if not tiles:
        raise ValueError("no faces to lay out")
    size = tiles[0].width
    rows = math.ceil(len(tiles) / cols)
    width = cols * size + (cols + 1) * pad
    height = rows * size + (rows + 1) * pad
    sheet = Image.new("RGB", (width, height), bg)
    for i, tile in enumerate(tiles):
        r, c = divmod(i, cols)
        sheet.paste(tile, (pad + c * (size + pad), pad + r * (size + pad)))
    return sheet


def synthetic_pano(width: int = 4096, height: int = 2048) -> Image.Image:
    """A fake equirect panorama: smooth gradients + labelled quadrant markers."""
    yy, xx = np.mgrid[0:height, 0:width].astype(np.float32)
    r = (xx / width) * 255.0
    g = (yy / height) * 255.0
    b = ((np.sin(xx / width * 8 * math.pi) * 0.5 + 0.5) * 255.0)
    img = np.stack([r, g, b], axis=-1)

    # Directional markers so we can verify orientation after reprojection.
    def box(y0, y1, x0, x1, color):
        img[y0:y1, x0:x1] = color

    box(height // 3, height // 2, int(width * 0.45), int(width * 0.55), (255, 255, 0))   # front-ish
    box(height // 3, height // 2, int(width * 0.70), int(width * 0.80), (0, 255, 255))   # right-ish
    box(height // 3, height // 2, int(width * 0.20), int(width * 0.30), (255, 0, 255))   # left-ish
    box(0, height // 8, int(width * 0.45), int(width * 0.55), (255, 255, 255))           # up pole
    box(height - height // 8, height, int(width * 0.45), int(width * 0.55), (0, 0, 0))   # down pole
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))


def tile_panorama(pano_path: Path, out_dir: Path, size: int) -> dict:
    t0 = time.time()
    pano = Image.open(pano_path)
    scene = pano_path.parent.name
    out_dir.mkdir(parents=True, exist_ok=True)

    faces = equirect_to_faces(pano, size=size)
    for name, face in faces.items():
        face.save(out_dir / f"{name}.png")
    contact_sheet(faces, cols=3).save(out_dir / "contact.png")

    manifest = {
        "source": pano_path.as_posix(),
        "scene": scene,
        "pano_size": list(pano.size),
        "tile_size": size,
        "order": [n for n in FACE_ORDER if n in faces],
        "files": {n: f"{n}.png" for n in faces},
        "contact": "contact.png",
        "seconds": round(time.time() - t0, 2),
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))
    return manifest


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pano", type=Path, help="equirect panorama (color.png)")
    ap.add_argument("--out", type=Path, default=Path("tiles"))
    ap.add_argument("--size", type=int, default=768, help="cube face edge in px")
    ap.add_argument("--selftest", action="store_true",
                    help="generate a synthetic panorama and tile it")
    args = ap.parse_args()

    if args.selftest:
        args.out.mkdir(parents=True, exist_ok=True)
        pano_path = args.out / "synthetic_color.png"
        synthetic_pano().save(pano_path)
        manifest = tile_panorama(pano_path, args.out, args.size)
    else:
        if args.pano is None:
            ap.error("--pano is required (or use --selftest)")
        manifest = tile_panorama(args.pano, args.out, args.size)

    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
