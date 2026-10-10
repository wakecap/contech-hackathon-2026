#!/usr/bin/env python3
"""
Build the demo dataset + imagery from the real Track A data.

Nothing is invented. Claims, statements, categories, verdicts, confidence scores
and model observations come straight from the challenge data and from the
ensemble run output. The only thing produced here is pixel derivatives (JPEG
previews) and a `data.js` mirror of those real records.

View geometry is copied from `solution/images.mjs` so the tiles shown in the
browser are byte-for-byte the crops the models were actually shown.

Imagery lands in `demo/assets/`, which is git-ignored: site imagery must never
be committed or redistributed.

Usage:
    python demo/build_assets.py
    python demo/build_assets.py --crop-width 768 --crop-overlap 0.33
    python demo/build_assets.py --scenes site_00/scene_00012
"""

from __future__ import annotations

import argparse
import json
import math
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image

Image.MAX_IMAGE_PIXELS = None

ROOT = Path(__file__).resolve().parent.parent
DEMO = Path(__file__).resolve().parent
ASSETS = DEMO / "assets"


# --------------------------------------------------------------------------
# view planning -- mirrors images.mjs exactly
# --------------------------------------------------------------------------
def plan_views(width, height, crop_width, crop_overlap, overview_max, include_seam):
    """Replicate the panorama_strip branch of solution/images.mjs."""
    cw = min(crop_width, width)
    step = max(1, math.floor(cw * (1 - crop_overlap)))

    starts, left = [], 0
    while left < width:
        v = min(left, width - cw)
        if v not in starts:
            starts.append(v)
        if cw >= width:
            break
        left += step

    views = [{
        "name": "overview",
        "kind": "overview",
        "label": "overview",
        "regions": [[0, 0, width, height]],
        "outSize": [min(overview_max, width),
                    max(1, round(height * min(overview_max, width) / width))],
    }]

    for left in starts:
        views.append({
            "name": f"crop_x{left}_to_{left + cw}",
            "kind": "crop",
            "label": f"x {left}–{left + cw}",
            "regions": [[left, 0, cw, height]],
            "outSize": [cw, height],
        })

    if include_seam and width > cw:
        right_w = cw // 2
        left_w = cw - right_w
        views.append({
            "name": f"seam_x{width - right_w}_to_{width}_then_x0_to_{left_w}",
            "kind": "seam",
            "label": f"wrap x {width - right_w}–{width} + 0–{left_w}",
            "regions": [[width - right_w, 0, right_w, height], [0, 0, left_w, height]],
            "outSize": [cw, height],
        })

    return views, cw, step


def render_view(im, view, quality):
    """Crop/composite one view the same way sharp does."""
    if view["kind"] == "overview":
        w, h = view["outSize"]
        return im.resize((w, h), Image.LANCZOS)

    if view["kind"] == "seam":
        cw, h = view["outSize"]
        out = Image.new("RGB", (cw, h), (0, 0, 0))
        (x1, y1, w1, _h1) = view["regions"][0]
        (x2, y2, w2, _h2) = view["regions"][1]
        out.paste(im.crop((x1, y1, x1 + w1, y1 + h)), (0, 0))
        out.paste(im.crop((x2, y2, x2 + w2, y2 + h)), (w1, 0))
        return out

    (x, y, w, h) = view["regions"][0]
    return im.crop((x, y, x + w, y + h))


# --------------------------------------------------------------------------
# real inputs
# --------------------------------------------------------------------------
def find_panorama_root():
    for candidate in (ROOT / "track_a" / "panoramas", ROOT / "data" / "track_a" / "panoramas"):
        if candidate.is_dir():
            return candidate
    raise SystemExit("panorama pack not found: expected track_a/panoramas/ or data/track_a/panoramas/")


def load_json(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def iter_runs():
    """Every ensemble run output, newest last."""
    runs = []
    results_dir = ROOT / "solution" / "results"
    if not results_dir.is_dir():
        return runs
    for latest in sorted(results_dir.glob("*/latest.json")):
        runs.append((latest.parent.name, load_json(latest)))
    return sorted(runs, key=lambda entry: entry[1].get("run_id", ""))


def index_runs(runs):
    """claimId -> {decision, models, run, item} using the newest run that saw it."""
    out = {}
    for run_name, payload in runs:
        for item in payload.get("items", []):
            for dec in item.get("decisions", []):
                models = []
                for rec in item.get("records", []):
                    for m in rec.get("decisions", []):
                        if m.get("claimId") == dec.get("claimId"):
                            models.append({
                                "modelId": rec.get("modelId"),
                                "model": rec.get("model"),
                                "pass": rec.get("pass"),
                                "verdict": m.get("verdict"),
                                "confidence": m.get("confidence"),
                                "observation": (m.get("observation") or "").strip(),
                                "limitation": (m.get("limitation") or "").strip(),
                                "views": m.get("views") or [],
                            })
                out[dec["claimId"]] = {
                    "run": run_name,
                    "item": item.get("id"),
                    "decision": {
                        "status": dec.get("status"),
                        "verdict": dec.get("verdict"),
                        "leading_verdict": dec.get("leading_verdict"),
                        "scores": dec.get("scores") or {},
                        "winner_share": dec.get("winner_share"),
                        "margin": dec.get("margin"),
                        "score_meaning": dec.get("score_meaning"),
                        "observation": (dec.get("observation") or "").strip(),
                        "evidence_views": dec.get("evidence_views") or [],
                        "evidence": dec.get("evidence") or [],
                    },
                    "models": models,
                }
    return out


# --------------------------------------------------------------------------
# build
# --------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--crop-width", type=int, default=None)
    ap.add_argument("--crop-overlap", type=float, default=None)
    ap.add_argument("--overview-max", type=int, default=None)
    ap.add_argument("--seam", action="store_true", help="include the wrap-around seam crop")
    ap.add_argument("--quality", type=int, default=84)
    ap.add_argument("--scenes", nargs="*", help="limit to specific sceneIds")
    ap.add_argument("--skip-images", action="store_true", help="only regenerate data.js")
    args = ap.parse_args()

    # geometry comes from the real run config, with images.mjs defaults
    cfg = load_json(ROOT / "solution" / "config.json")
    crop_width = args.crop_width or cfg.get("crop_width", 1024)
    crop_overlap = args.crop_overlap if args.crop_overlap is not None else cfg.get("crop_overlap", 0.25)
    overview_max = args.overview_max or cfg.get("max_image_edge", 2048)
    include_seam = bool(cfg.get("include_seam_crop")) or args.seam

    claims_all = load_json(ROOT / "data" / "track_a" / "claims.json")["claims"]
    scenes_all = load_json(ROOT / "data" / "track_a" / "scenes.json")["scenes"]
    runs = iter_runs()
    by_claim = index_runs(runs)

    pano_root = find_panorama_root()
    claims_by_scene = {}
    for c in claims_all:
        claims_by_scene.setdefault(c["sceneId"], []).append(c)

    only = set(args.scenes) if args.scenes else None

    scenes_out, claims_out = [], []
    missing_panorama = 0

    for sc in scenes_all:
        scene_id = sc["sceneId"]
        if only and scene_id not in only:
            continue

        rel = sc["panoramas"][0]
        src = pano_root / rel
        if not src.exists():
            missing_panorama += 1
            continue

        with Image.open(src) as raw:
            im = raw.convert("RGB")
        W, H = im.size
        views, cw, step = plan_views(W, H, crop_width, crop_overlap, overview_max, include_seam)

        key = scene_id.replace("/", "__")
        pano_rel = f"assets/pano/{key}.jpg"
        if not args.skip_images:
            (ASSETS / "pano").mkdir(parents=True, exist_ok=True)
            (ASSETS / "views" / key).mkdir(parents=True, exist_ok=True)
            im.save(ASSETS / "pano" / f"{key}.jpg",
                    quality=args.quality, optimize=True, progressive=True)
            for v in views:
                tile = render_view(im, v, args.quality)
                tile.save(ASSETS / "views" / key / f"{v['name']}.jpg",
                          quality=args.quality, optimize=True, progressive=True)

        views_out = [{
            "name": v["name"], "kind": v["kind"], "label": v["label"],
            "regions": v["regions"], "outSize": v["outSize"],
            "src": f"assets/views/{key}/{v['name']}.jpg",
        } for v in views]

        scene_claims = []
        for c in claims_by_scene.get(scene_id, []):
            hit = by_claim.get(c["claimId"])
            rec = {
                "claimId": c["claimId"],
                "sceneId": scene_id,
                "category": c["category"],
                "statement": c["statement"],
                "status": "pending",
                "verdict": None,
                "leading_verdict": None,
                "scores": {}, "winner_share": None, "margin": None,
                "score_meaning": None,
                "observation": "",
                "evidence_views": [], "evidence": [],
                "models": [],
                "run": None,
            }
            if hit:
                rec.update(hit["decision"])
                rec["models"] = hit["models"]
                rec["run"] = hit["run"]
            claims_out.append(rec)
            scene_claims.append(rec["claimId"])

        scenes_out.append({
            "sceneId": scene_id, "site": sc["site"], "scene": sc["scene"],
            "panorama": f"assets/pano/{key}.jpg",
            "width": W, "height": H,
            "views": views_out, "claims": scene_claims,
        })

    geometry = {
        "cropWidth": crop_width, "cropOverlap": crop_overlap, "step": step,
        "overviewMax": overview_max, "includeSeam": include_seam,
        "runs": [name for name, _ in runs],
        "models": sorted({m["model"] for r in by_claim.values() for m in r["models"]}),
    }

    payload = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "geometry": geometry,
        "scenes": scenes_out,
        "claims": claims_out,
    }

    ASSETS.mkdir(parents=True, exist_ok=True)
    with open(DEMO / "data.js", "w", encoding="utf-8") as fh:
        fh.write("// generated by demo/build_assets.py -- do not edit by hand\n")
        fh.write("window.DEMO = ")
        json.dump(payload, fh, ensure_ascii=False, separators=(",", ":"))
        fh.write(";\n")

    checked = sum(1 for c in claims_out if c["status"] != "pending")
    print(f"scenes      : {len(scenes_out)} ({missing_panorama} missing panorama)")
    print(f"claims      : {len(claims_out)} ({checked} checked)")
    print(f"views/scene : {len(scenes_out[0]['views']) if scenes_out else 0} "
          f"(crop {crop_width}px, overlap {crop_overlap:.0%}, step {step}px)")
    print(f"data.js     : {(DEMO / 'data.js').stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
