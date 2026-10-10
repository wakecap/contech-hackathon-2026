
import json
import csv
from pathlib import Path

from sklearn.metrics import (
    accuracy_score,
    f1_score,
    classification_report,
    confusion_matrix
)

BASE = Path(__file__).resolve().parent

predictions = json.loads(
    (BASE / "outputs/pseudo_labels.json").read_text(
        encoding="utf-8"
    )
)

reference_path = BASE / "outputs/reference_labels.csv"

with reference_path.open(
    newline="", encoding="utf-8"
) as f:
    references = {
        row["claimId"]: row["reference_label"]
        for row in csv.DictReader(f)
    }

labels = ["supported", "refuted", "no_evidence"]

splits = {
    "Validation": {"site_03"},
    "Test": {"site_08", "site_12"}
}

for split_name, sites in splits.items():

    selected = [
        p for p in predictions
        if p["sceneId"].split("/")[0] in sites
        and p["claimId"] in references
    ]

    print(f"\n===== {split_name.upper()} =====")
    print("Reviewed samples:", len(selected))

    if not selected:
        print("No reference labels available.")
        continue

    y_true = [
        references[p["claimId"]] for p in selected
    ]
    y_pred = [
        p["label"] for p in selected
    ]

    print("Accuracy:", round(
        accuracy_score(y_true, y_pred), 4
    ))

    print("Macro F1:", round(
        f1_score(
            y_true, y_pred,
            labels=labels,
            average="macro",
            zero_division=0
        ), 4
    ))

    print("\nClassification report:")
    print(classification_report(
        y_true, y_pred,
        labels=labels,
        zero_division=0
    ))

    print("\nConfusion matrix:")
    print(confusion_matrix(
        y_true, y_pred,
        labels=labels
    ))

    print("\nDisagreements:")
    for p in selected:
        expected = references[p["claimId"]]
        if expected != p["label"]:
            print(
                p["claimId"],
                "Predicted:", p["label"],
                "Reference:", expected
            )
