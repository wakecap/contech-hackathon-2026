import argparse
import json
from pathlib import Path

BASE = Path(__file__).resolve().parent
TEAM_NAME = "Team 3"
VALID_LABELS = {"supported", "refuted", "no_evidence"}


def build_submission(predictions=None, dataset_dir=None, panorama_dir=None):
    dataset_dir = Path(dataset_dir) if dataset_dir else BASE / "Dataset"
    panorama_dir = Path(panorama_dir) if panorama_dir else (
        dataset_dir / "track_a_panoramas" / "track_a" / "panoramas"
    )
    if predictions is None:
        predictions = json.loads(
            (BASE / "outputs" / "pseudo_labels.json").read_text(encoding="utf-8")
        )
    claims = json.loads(
        (dataset_dir / "claims.json").read_text(encoding="utf-8")
    )["claims"]
    scenes = json.loads(
        (dataset_dir / "scenes.json").read_text(encoding="utf-8")
    )["scenes"]
    prediction_lookup = {row["claimId"]: row for row in predictions}
    if len(prediction_lookup) != len(predictions):
        raise ValueError("Duplicate prediction IDs")
    required_ids = {claim["claimId"] for claim in claims}
    if set(prediction_lookup) != required_ids:
        missing = sorted(required_ids - set(prediction_lookup))
        extra = sorted(set(prediction_lookup) - required_ids)
        raise ValueError(f"Prediction IDs do not match claims: missing={missing}, extra={extra}")
    scene_lookup = {scene["sceneId"]: scene for scene in scenes}
    submission = {"team": TEAM_NAME, "track_a": [], "track_b": []}
    for claim in claims:
        claim_id = claim["claimId"]
        row = prediction_lookup[claim_id]
        if row.get("sceneId") != claim["sceneId"]:
            raise ValueError(f"{claim_id}: prediction belongs to a different scene")
        verdict = row.get("label")
        if verdict not in VALID_LABELS:
            raise ValueError(f"{claim_id}: invalid verdict {verdict!r}")
        entry = {
            "claimId": claim_id,
            "verdict": verdict,
            "rationale": row.get("reason", "")
        }
        if verdict != "no_evidence":
            panoramas = scene_lookup[claim["sceneId"]].get("panoramas") or []
            if not panoramas:
                raise ValueError(f"{claim_id}: scene has no panorama")
            citations = row.get("evidence") or [claim["sceneId"]]
            evidence = []
            for citation in citations:
                panorama = panoramas[0] if citation == claim["sceneId"] else citation
                if panorama not in panoramas:
                    raise ValueError(f"{claim_id}: citation is outside this scene: {panorama}")
                if not (panorama_dir / panorama).is_file():
                    raise ValueError(f"{claim_id}: cited image is missing: {panorama}")
                if panorama not in evidence:
                    evidence.append(panorama)
            entry["evidence"] = evidence
        submission["track_a"].append(entry)
    return submission


def main():
    parser = argparse.ArgumentParser(description="Build the validated Team 3 evidence log.")
    parser.add_argument("--output", type=Path, default=BASE / "my_submission.json")
    args = parser.parse_args()
    submission = build_submission()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(submission, indent=2), encoding="utf-8")
    print("Submission created:", args.output)
    print("Team:", submission["team"])
    print("Track A predictions:", len(submission["track_a"]))
    print("Track B:", len(submission["track_b"]))


if __name__ == "__main__":
    main()
