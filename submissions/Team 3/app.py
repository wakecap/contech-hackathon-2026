import os
import json
import csv
import io
import base64
from pathlib import Path
from collections import Counter

import requests
import pandas as pd
import streamlit as st

from PIL import Image
from dotenv import load_dotenv
from make_submission import build_submission
from sklearn.metrics import (
    accuracy_score,
    f1_score,
    confusion_matrix,
    classification_report
)

# =============================================
# 1. CONFIGURATION
# =============================================

BASE_DIR = Path(__file__).resolve().parent
DATASET_DIR = BASE_DIR / "Dataset"

PANORAMA_DIR = (
    DATASET_DIR
    / "track_a_panoramas"
    / "track_a"
    / "panoramas"
)

PREDICTION_PATH = (
    BASE_DIR / "outputs" / "pseudo_labels.json"
)

REFERENCE_PATH = (
    BASE_DIR / "outputs" / "reference_labels.csv"
)

SCENES_PATH = DATASET_DIR / "scenes.json"

LABELS = [
    "supported",
    "refuted",
    "no_evidence"
]

MODEL = "gemini-3.5-flash-lite"

load_dotenv(BASE_DIR / ".env", override=True)
API_KEY = os.getenv("GEMINI_API_KEY")

TRAIN_SITES = {
    "site_00", "site_01", "site_02",
    "site_05", "site_09"
}

VAL_SITES = {"site_03"}

TEST_SITES = {
    "site_08", "site_12"
}

# =============================================
# 2. PAGE CONFIGURATION
# =============================================

st.set_page_config(
    page_title="Rohbau3D - AI Construction Inspector",
    page_icon="🏗️",
    layout="wide"
)

# =============================================
# 3. LOAD DATA
# =============================================

if not PREDICTION_PATH.exists():
    st.error(
        "Missing outputs/pseudo_labels.json. "
        "Run label_all.py first."
    )
    st.stop()

predictions = json.loads(
    PREDICTION_PATH.read_text(encoding="utf-8")
)

scenes = json.loads(
    SCENES_PATH.read_text(encoding="utf-8")
)["scenes"]

scene_index = {
    s["sceneId"]: s for s in scenes
}

prediction_index = {
    p["claimId"]: p for p in predictions
}


def get_image_path(scene_id):
    scene = scene_index[scene_id]

    return (
        PANORAMA_DIR
        / scene["panoramas"][0]
    )


def get_split(row):
    site = row["sceneId"].split("/")[0]

    if site in TRAIN_SITES:
        return "Training"
    if site in VAL_SITES:
        return "Validation"
    if site in TEST_SITES:
        return "Testing"

    return "Unknown"


def load_reference_labels():
    if not REFERENCE_PATH.exists():
        return {}

    with REFERENCE_PATH.open(
        newline="", encoding="utf-8"
    ) as file:
        return {
            r["claimId"]: r["reference_label"]
            for r in csv.DictReader(file)
            if r["reference_label"] in LABELS
        }


def save_reference_label(claim_id, label):
    references = load_reference_labels()
    references[claim_id] = label

    REFERENCE_PATH.parent.mkdir(
        parents=True, exist_ok=True
    )

    with REFERENCE_PATH.open(
        "w", newline="", encoding="utf-8"
    ) as file:
        writer = csv.writer(file)

        writer.writerow([
            "claimId", "reference_label"
        ])

        for cid, value in sorted(references.items()):
            writer.writerow([cid, value])


# =============================================
# 4. PANORAMA VIEWER
# =============================================

def show_panorama(scene_id, key):
    image_path = get_image_path(scene_id)

    if not image_path.exists():
        st.error(f"Missing image: {image_path}")
        return

    view_option = st.selectbox(
        "Image view",
        [
            "Full 360° panorama",
            "Zoom: Section 1",
            "Zoom: Section 2",
            "Zoom: Section 3",
            "Zoom: Section 4"
        ],
        key=key
    )

    with Image.open(image_path) as source:
        image = source.convert("RGB")

    if view_option == "Full 360° panorama":
        st.image(
            image,
            caption=scene_id,
            use_container_width=True
        )

    else:
        section = int(view_option[-1]) - 1

        width, height = image.size
        section_width = width // 4

        left = section * section_width
        right = min(
            left + section_width, width
        )

        cropped = image.crop(
            (left, 0, right, height)
        )

        st.image(
            cropped,
            caption=f"{scene_id} - Zoomed section",
            use_container_width=True
        )


# =============================================
# 5. OPTIONAL LIVE GEMINI INFERENCE
# =============================================

def verify_with_gemini(scene_id, claim_text):

    if not API_KEY:
        raise ValueError(
            "GEMINI_API_KEY is missing from .env"
        )

    image_path = get_image_path(scene_id)

    with Image.open(image_path) as img:
        img = img.convert("RGB")
        img.thumbnail((2048, 1024))

        buffer = io.BytesIO()
        img.save(
            buffer,
            format="JPEG",
            quality=85
        )

    encoded_image = base64.b64encode(
        buffer.getvalue()
    ).decode("utf-8")

    prompt = f"""
You are a construction visual claim verifier.

You are given a 360-degree panorama of a
German construction site.

CLAIM:
{claim_text}

Return exactly one verdict:

supported:
Direct visible evidence confirms the claim.

refuted:
Direct visible evidence contradicts the claim.

no_evidence:
The image cannot reliably establish the claim.

Important:
- Never assume hidden objects are installed.
- Treat "fully" and "all" strictly.
- Do not confuse concrete with plaster.
- Do not confuse concrete slabs with screed.
- Do not confuse conduits with socket boxes.
- Do not infer testing from visual appearance.
- Do not guess when evidence is insufficient.
- Provide a short evidence-based explanation.

Return JSON only:

{{
    "label": "supported",
    "reason": "Short explanation"
}}
"""

    url = (
        "https://generativelanguage.googleapis.com/"
        f"v1beta/models/{MODEL}:generateContent"
    )

    payload = {
        "contents": [
            {
                "role": "user",
                "parts": [
                    {"text": prompt},
                    {
                        "inline_data": {
                            "mime_type": "image/jpeg",
                            "data": encoded_image
                        }
                    }
                ]
            }
        ],
        "generationConfig": {
            "responseMimeType": "application/json"
        }
    }

    response = requests.post(
        url,
        headers={
            "x-goog-api-key": API_KEY,
            "Content-Type": "application/json"
        },
        json=payload,
        timeout=120
    )

    response.raise_for_status()

    response_data = response.json()

    text = "".join(
        part.get("text", "")
        for part in response_data["candidates"][0]
        ["content"]["parts"]
    )

    result = json.loads(text)

    if result.get("label") not in LABELS:
        raise ValueError("Invalid Gemini verdict")

    return result


# =============================================
# 6. APPLICATION HEADER
# =============================================

st.title("🏗️ Rohbau3D")
st.subheader("AI-Powered Construction Claim Verification")

st.caption(
    "Multimodal Vision-Language Verification | "
    "Gemini 3.5 Flash-Lite"
)

st.divider()

# =============================================
# 7. DATASET OVERVIEW
# =============================================

counts = Counter(
    p["label"] for p in predictions
)

a, b, c, d = st.columns(4)

a.metric("Total Claims", len(predictions))
b.metric("Supported", counts["supported"])
c.metric("Refuted", counts["refuted"])
d.metric("No Evidence", counts["no_evidence"])

st.divider()

tab1, tab2, tab3, tab4 = st.tabs([
    "🔎 AI Verification",
    "🏷️ Human Label Review",
    "📊 Model Evaluation",
    "📥 Submission"
])

# =============================================
# TAB 1: AI VERIFICATION
# =============================================

with tab1:

    st.header("Construction Claim Verification")

    claim_ids = sorted(prediction_index)

    selected_id = st.selectbox(
        "Select claim",
        claim_ids,
        format_func=lambda cid: (
            f"{cid} - "
            f"{prediction_index[cid]['statement']}"
        )
    )

    selected = prediction_index[selected_id]

    left, right = st.columns([3, 2])

    with left:
        show_panorama(
            selected["sceneId"],
            "demo_panorama"
        )

    with right:
        st.markdown("### Claim Information")

        st.write(
            "**Claim ID:**",
            selected["claimId"]
        )

        st.write(
            "**Scene:**",
            selected["sceneId"]
        )

        st.write(
            "**Category:**",
            selected["category"]
        )

        st.write(
            "**Statement:**",
            selected["statement"]
        )

        st.markdown("### Saved AI Prediction")

        verdict = selected["label"]

        if verdict == "supported":
            st.success("SUPPORTED")

        elif verdict == "refuted":
            st.error("REFUTED")

        else:
            st.warning("NO EVIDENCE")

        st.write(
            "**Explanation:**",
            selected["reason"]
        )

        st.write(
            "**Evidence:**",
            scene_index[selected["sceneId"]]["panoramas"][0]
            if verdict != "no_evidence"
            else "No reliable visible evidence; citation is optional."
        )

        st.caption(
            "Saved zero-shot VLM prediction. "
            "Not an independently verified label."
        )

    st.divider()

    st.markdown("### Live AI Verification")

    custom_claim = st.text_area(
        "Claim to verify",
        value=selected["statement"],
        key=selected_id
    )

    if st.button(
        "Verify with Gemini",
        type="primary"
    ):

        with st.spinner(
            "Gemini is analyzing the panorama..."
        ):

            try:
                result = verify_with_gemini(
                    selected["sceneId"],
                    custom_claim
                )

                st.subheader("Live Prediction")

                if result["label"] == "supported":
                    st.success("SUPPORTED")

                elif result["label"] == "refuted":
                    st.error("REFUTED")

                else:
                    st.warning("NO EVIDENCE")

                st.write(
                    "**Reason:**",
                    result["reason"]
                )

            except Exception as error:
                st.error(
                    f"Gemini API error: {error}"
                )


# =============================================
# TAB 2: HUMAN LABEL REVIEW
# =============================================

with tab2:

    st.header("Independent Human Label Review")

    st.info(
        "Inspect the panorama and decide the correct "
        "label independently. The model's prediction "
        "is intentionally hidden in this tab."
    )

    references = load_reference_labels()

    split_choice = st.selectbox(
        "Select dataset split",
        [
            "Validation",
            "Testing",
            "Training"
        ]
    )

    split_rows = [
        p for p in predictions
        if get_split(p) == split_choice
    ]

    reviewed_count = sum(
        p["claimId"] in references
        for p in split_rows
    )

    st.progress(
        reviewed_count / max(len(split_rows), 1)
    )

    st.write(
        f"Reviewed: {reviewed_count} / "
        f"{len(split_rows)}"
    )

    only_pending = st.checkbox(
        "Show only claims not yet reviewed",
        value=True
    )

    if only_pending:
        review_rows = [
            p for p in split_rows
            if p["claimId"] not in references
        ]
    else:
        review_rows = split_rows

    if not review_rows:
        st.success(
            "All claims in this split have been reviewed."
        )

    else:
        review_index = {
            p["claimId"]: p
            for p in review_rows
        }

        review_id = st.selectbox(
            "Select claim for human review",
            list(review_index),
            format_func=lambda cid: (
                f"{cid} - "
                f"{review_index[cid]['statement']}"
            )
        )

        review_row = review_index[review_id]

        st.markdown("### Claim")

        st.write(review_row["statement"])

        st.write(
            "**Scene:**",
            review_row["sceneId"]
        )

        st.divider()

        st.markdown("### Visual Evidence")

        show_panorama(
            review_row["sceneId"],
            "review_panorama"
        )

        st.divider()

        st.markdown("### Assign Reference Label")

        existing = references.get(review_id)

        choices = [
            "Select a label"
        ] + LABELS

        default_index = (
            choices.index(existing)
            if existing in LABELS
            else 0
        )

        with st.form("review_form"):

            human_label = st.selectbox(
                "Your decision",
                choices,
                index=default_index
            )

            submit_review = st.form_submit_button(
                "Save Human Label",
                type="primary"
            )

        if submit_review:

            if human_label not in LABELS:
                st.warning(
                    "Please select a valid label."
                )

            else:
                save_reference_label(
                    review_id,
                    human_label
                )

                st.success(
                    "Human label saved successfully."
                )

                st.rerun()

    if REFERENCE_PATH.exists():
        st.download_button(
            "Download Reference Labels CSV",
            REFERENCE_PATH.read_bytes(),
            file_name="reference_labels.csv",
            mime="text/csv"
        )


# =============================================
# TAB 3: MODEL EVALUATION
# =============================================

with tab3:

    st.header("Model Evaluation")

    references = load_reference_labels()

    st.metric(
        "Human-reviewed claims",
        len(references)
    )

    if not references:
        st.warning(
            "No reference labels found. "
            "Complete human review first."
        )

    else:
        for split_name in [
            "Validation",
            "Testing"
        ]:

            st.subheader(
                f"{split_name} Results"
            )

            split_rows = [
                p for p in predictions
                if get_split(p) == split_name
            ]

            reviewed = [
                p for p in split_rows
                if p["claimId"] in references
            ]

            st.write(
                f"Reviewed samples: "
                f"{len(reviewed)} / {len(split_rows)}"
            )

            if not reviewed:
                st.info(
                    "No reviewed labels available "
                    "for this split."
                )
                continue

            y_true = [
                references[p["claimId"]]
                for p in reviewed
            ]

            y_pred = [
                p["label"]
                for p in reviewed
            ]

            accuracy = accuracy_score(
                y_true, y_pred
            )

            macro_f1 = f1_score(
                y_true,
                y_pred,
                labels=LABELS,
                average="macro",
                zero_division=0
            )

            col1, col2 = st.columns(2)

            col1.metric(
                "Accuracy",
                f"{accuracy:.3f}"
            )

            col2.metric(
                "Macro F1",
                f"{macro_f1:.3f}"
            )

            if len(reviewed) < len(split_rows):
                st.warning(
                    "Partial evaluation: some claims "
                    "do not have reference labels."
                )

            st.markdown("#### Classification Report")

            report = classification_report(
                y_true,
                y_pred,
                labels=LABELS,
                output_dict=True,
                zero_division=0
            )

            st.dataframe(
                pd.DataFrame(report).T,
                use_container_width=True
            )

            st.markdown("#### Confusion Matrix")

            cm = confusion_matrix(
                y_true,
                y_pred,
                labels=LABELS
            )

            cm_df = pd.DataFrame(
                cm,
                index=LABELS,
                columns=LABELS
            )

            cm_df.index.name = "Actual"
            cm_df.columns.name = "Predicted"

            st.dataframe(
                cm_df,
                use_container_width=True
            )

            st.markdown("#### Incorrect Predictions")

            errors = []

            for p in reviewed:

                actual = references[p["claimId"]]

                if actual != p["label"]:

                    errors.append({
                        "Claim ID": p["claimId"],
                        "Statement": p["statement"],
                        "Predicted": p["label"],
                        "Reference": actual
                    })

            if errors:
                st.dataframe(
                    pd.DataFrame(errors),
                    use_container_width=True
                )
            else:
                st.success(
                    "No disagreements among "
                    "the reviewed claims."
                )

# =============================================
# FOOTER
# =============================================

with tab4:
    st.header("Team 3 — Submission")
    st.caption("Export saved predictions with the exact official panorama citations.")
    try:
        submission = build_submission(
            predictions=predictions,
            dataset_dir=DATASET_DIR,
            panorama_dir=PANORAMA_DIR
        )
    except (ValueError, KeyError, OSError, TypeError) as error:
        st.error(f"Submission export blocked: {error}")
    else:
        st.success(
            f"{len(submission['track_a'])} Track A claims checked: "
            "exact IDs, valid verdicts, scene citations and existing images."
        )
        st.info("Track B is optional and empty. Human reference labels are evaluation-only.")
        references = load_reference_labels()
        disagreements = [
            {
                "Claim ID": row["claimId"],
                "Submitted verdict": row["label"],
                "Human reference": references[row["claimId"]]
            }
            for row in predictions
            if row["claimId"] in references
            and row["label"] != references[row["claimId"]]
        ]
        if disagreements:
            st.warning("Review these disagreements before submitting; references do not override predictions.")
            st.dataframe(pd.DataFrame(disagreements), use_container_width=True)
        st.download_button(
            "Download Team 3 submission.json",
            json.dumps(submission, indent=2),
            file_name="submission.json",
            mime="application/json",
            type="primary"
        )
        st.caption("Validation confirms format and citation paths, not verdict accuracy.")

st.divider()

st.caption(
    "Rohbau3D | Track A | "
    "Construction Claim Verification | "
    "Gemini 3.5 Flash-Lite"
)
