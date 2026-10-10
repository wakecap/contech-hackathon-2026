
import os
import json
import io
import base64
import time
import requests

from pathlib import Path
from collections import defaultdict
from PIL import Image
from dotenv import load_dotenv

# ==========================================
# CONFIGURATION
# ==========================================

BASE_DIR = Path(__file__).resolve().parent
DATASET_DIR = BASE_DIR / "Dataset"

CLAIMS_PATH = DATASET_DIR / "claims.json"
SCENES_PATH = DATASET_DIR / "scenes.json"

PANORAMA_DIR = (
    DATASET_DIR
    / "track_a_panoramas"
    / "track_a"
    / "panoramas"
)

OUTPUT_DIR = BASE_DIR / "outputs"
OUTPUT_DIR.mkdir(exist_ok=True)

OUTPUT_PATH = OUTPUT_DIR / "pseudo_labels.json"

load_dotenv(BASE_DIR / ".env", override=True)
API_KEY = os.getenv("GEMINI_API_KEY")

if not API_KEY:
    raise ValueError("Missing GEMINI_API_KEY")

MODEL = "gemini-3.5-flash-lite"

URL = (
    "https://generativelanguage.googleapis.com/"
    f"v1beta/models/{MODEL}:generateContent"
)

VALID_LABELS = {
    "supported",
    "refuted",
    "no_evidence"
}

# ==========================================
# LOAD DATA
# ==========================================

claims = json.loads(
    CLAIMS_PATH.read_text(encoding="utf-8")
)["claims"]

scenes = json.loads(
    SCENES_PATH.read_text(encoding="utf-8")
)["scenes"]

scene_index = {
    s["sceneId"]: s for s in scenes
}

grouped_claims = defaultdict(list)

for claim in claims:
    grouped_claims[claim["sceneId"]].append(claim)

print("Total claims:", len(claims))
print("Scenes requiring verification:", len(grouped_claims))

# ==========================================
# IMAGE PROCESSING
# ==========================================

def encode_image(scene_id):
    scene = scene_index[scene_id]

    path = PANORAMA_DIR / scene["panoramas"][0]

    if not path.is_file():
        raise FileNotFoundError(path)

    with Image.open(path) as img:
        img = img.convert("RGB")
        img.thumbnail((2048, 1024))

        buffer = io.BytesIO()
        img.save(
            buffer,
            format="JPEG",
            quality=85
        )

    encoded = base64.b64encode(
        buffer.getvalue()
    ).decode("utf-8")

    return encoded, str(path)


# ==========================================
# VLM INFERENCE
# ==========================================

def verify_scene(scene_id, scene_claims):

    image_base64, image_path = encode_image(scene_id)


    prompt = f"""
You are an expert construction visual inspector
specializing in construction progress verification.

TASK:
Analyze a 360-degree equirectangular panorama rendered
from a terrestrial laser scan of a German construction site.

Verify every contractor claim independently using ONLY
the visual evidence provided.

CLAIMS:
{json.dumps(scene_claims, indent=2)}

=====================================
POSSIBLE CLASSIFICATION LABELS
=====================================

1. supported:
The visible evidence clearly confirms the claim.
The relevant object or construction work can be
identified with sufficient visual certainty.

2. refuted:
The visible evidence clearly contradicts the claim.
The relevant work is visibly absent, incomplete,
or inconsistent with the stated completion status.

3. no_evidence:
The available panorama cannot reliably establish
whether the claim is true or false.

Examples include:
- Hidden or concealed construction elements
- Objects outside the visible area
- Ambiguous material appearances
- Work requiring measurements or testing
- Claims about previous construction conditions
- Claims involving unobservable completion status

=====================================
MANDATORY CONSTRUCTION RULES
=====================================

RULE 1 — HIDDEN INSTALLATIONS
Never assume concealed reinforcement, electrical
conduits, plumbing, insulation, waterproofing,
or embedded materials are installed.

Visible exposed installations can provide evidence.
Hidden installations require additional documentation.

RULE 2 — ABSOLUTE COMPLETION CLAIMS
Interpret "all", "fully", "complete", and
"throughout" literally.

- If relevant unfinished work is visibly present,
  classify as refuted.
- If all relevant areas are sufficiently visible
  and clearly finished, classify as supported.
- If significant relevant areas cannot be inspected,
  classify as no_evidence.

RULE 3 — NO UNSUPPORTED ASSUMPTIONS
Never guess based on typical construction practices.

Do not assume something is installed just because
it would normally be installed at that stage.

If visual evidence cannot distinguish alternatives,
classify as no_evidence.

RULE 4 — CONCRETE VS PLASTER
Distinguish structural concrete from applied plaster.

Bare concrete may show:
- Formwork marks
- Exposed concrete texture
- Construction joints
- Rough unfinished surfaces

Plastered surfaces generally show a distinct applied,
more uniform finishing layer.

A smooth concrete surface alone does not prove plaster.

RULE 5 — CONCRETE SLAB VS FLOOR SCREED
Do not confuse structural concrete slabs with
separately applied floor screed.

A flat or smooth floor alone is NOT sufficient
evidence that screed has been laid.

Look for visible layer boundaries, level differences,
or other clear indicators.

If these cannot be distinguished, use no_evidence.

RULE 6 — ELECTRICAL AND MEP INSTALLATIONS
Distinguish between:
- Visible conduits
- Socket back-boxes
- Electrical cables
- Distribution boards
- Ventilation ducts
- Plumbing pipework
- Sprinkler systems

Do not confuse one type with another.

Presence of wiring does not necessarily prove
that electrical socket boxes are installed.

Presence of pipes does not prove that a system
has been tested, charged, or commissioned.

RULE 7 — CONSTRUCTION COMPLETION STAGES
Distinguish:
- Materials stored on site
- Work partially installed
- Work fully installed
- Work covered or finished

Materials staged on the floor are not the same
as installed construction elements.

An installed frame does not necessarily mean
the associated door, glazing, or fixture is installed.

RULE 8 — WINDOWS AND DOORS
Verify windows and doors using visible frames,
glazing, door leaves, and installation details.

Do not confuse empty openings with installed windows.

A door frame alone does not mean a door leaf is hung.

A visible window cannot establish that it is newly
installed or has replaced an earlier window unless
appropriate comparative evidence exists.

RULE 9 — TESTING AND CERTIFICATION
Never confirm pressure testing, electrical testing,
waterproofing performance, or system commissioning
from visual appearance alone.

Such claims require test results or inspection records.

If the claim depends on these unavailable records,
use no_evidence.

RULE 10 — VISUAL LIMITATIONS
The input is a laser-scan panorama, not a normal photo.

It may contain:
- Distortion from equirectangular projection
- Scanner shadows
- Black or missing regions
- Unusual lighting and color
- Occluded construction elements

Do not interpret scanner artifacts as physical defects.

Do not treat objects outside the visible area
as necessarily absent.

RULE 11 — CONTRADICTION VS MISSING EVIDENCE
Use refuted only when visual evidence actually
contradicts the claim.

Use no_evidence when the information is simply
missing or visually ambiguous.

Absence of visible evidence is not always
evidence that the claimed work is absent.

RULE 12 — EXPLANATIONS
Provide a short, specific explanation for every
prediction based on visible construction features.

Mention what is visible, unfinished, missing,
or impossible to determine.

Do not invent standards, measurements,
test results, or inspection records.

=====================================
OUTPUT FORMAT
=====================================

Return ONLY valid JSON.

{{
  "results": [
    {{
      "claimId": "A-0001",
      "label": "supported",
      "reason": "Windows with installed frames and glazing are visible."
    }}
  ]
}}

Requirements:
- Return exactly one result for every input claim.
- Preserve original claim IDs.
- Only use supported, refuted, or no_evidence.
- Keep explanations concise and evidence-based.
- Do not omit any claims.
"""

    payload = {
        "contents": [
            {
                "role": "user",
                "parts": [
                    {"text": prompt},
                    {
                        "inline_data": {
                            "mime_type": "image/jpeg",
                            "data": image_base64
                        }
                    }
                ]
            }
        ],
        "generationConfig": {
            "responseMimeType": "application/json"
        }
    }

    for attempt in range(4):

        try:
            response = requests.post(
                URL,
                headers={
                    "x-goog-api-key": API_KEY,
                    "Content-Type": "application/json"
                },
                json=payload,
                timeout=120
            )

            if response.status_code in (429, 500, 502, 503, 504):
                if attempt < 3:
                    delay = 10 * (2 ** attempt)
                    print(
                        f"HTTP {response.status_code}. "
                        f"Waiting {delay}s..."
                    )
                    time.sleep(delay)
                    continue

            response.raise_for_status()

            body = response.json()

            content_parts = body["candidates"][0]["content"]["parts"]

            raw_text = "".join(
                p.get("text", "") for p in content_parts
            )

            data = json.loads(raw_text)
            predictions = data["results"]

            expected = {
                c["claimId"] for c in scene_claims
            }

            received = [
                p["claimId"] for p in predictions
            ]

            if (
                len(received) != len(expected)
                or set(received) != expected
            ):
                raise ValueError(
                    f"Invalid claim IDs for {scene_id}"
                )

            for prediction in predictions:
                if prediction["label"] not in VALID_LABELS:
                    raise ValueError("Invalid label")

            original = {
                c["claimId"]: c for c in scene_claims
            }

            results = []

            for prediction in predictions:

                claim_id = prediction["claimId"]

                results.append({
                    **original[claim_id],
                    "label": prediction["label"],
                    "reason": prediction["reason"],
                    "evidence": [scene_id],
                    "image_path": image_path,
                    "model": MODEL,
                    "label_source": "vlm_pseudo",
                    "review_status": "unreviewed"
                })

            return results

        except requests.exceptions.Timeout:
            if attempt == 3:
                raise
            time.sleep(10)

    raise RuntimeError(
        f"Failed to process scene {scene_id}"
    )


# ==========================================
# SAVE PROGRESS
# ==========================================

def save_predictions(predictions):

    ordered = sorted(
        predictions.values(),
        key=lambda x: x["claimId"]
    )

    OUTPUT_PATH.write_text(
        json.dumps(
            ordered,
            indent=2,
            ensure_ascii=False
        ),
        encoding="utf-8"
    )


# ==========================================
# MAIN PIPELINE
# ==========================================

def main():

    saved = {}

    if OUTPUT_PATH.exists():
        existing = json.loads(
            OUTPUT_PATH.read_text(encoding="utf-8")
        )

        saved = {
            row["claimId"]: row for row in existing
        }

    total_scenes = len(grouped_claims)

    for index, (scene_id, scene_claims) in enumerate(
        grouped_claims.items(), start=1
    ):

        claim_ids = [
            c["claimId"] for c in scene_claims
        ]

        if all(cid in saved for cid in claim_ids):
            print(f"[{index}/{total_scenes}] Skipping {scene_id}")
            continue

        print(
            f"\n[{index}/{total_scenes}] "
            f"Processing {scene_id}"
        )

        try:
            results = verify_scene(
                scene_id, scene_claims
            )

            for result in results:
                saved[result["claimId"]] = result

            save_predictions(saved)

            print(
                f"Saved {len(saved)}/{len(claims)} claims"
            )

        except Exception as error:
            print(f"Stopped at {scene_id}: {error}")
            print("Progress has been saved. Rerun to resume.")
            break

        # Reduce the risk of exceeding API rate limits.
        time.sleep(5)

    print("\n======================")
    print("COMPLETED:", len(saved), "/", len(claims))
    print("OUTPUT:", OUTPUT_PATH)


if __name__ == "__main__":
    main()
