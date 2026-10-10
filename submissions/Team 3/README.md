# Rohbau3D — Team 3

Track A construction claim verification from 360-degree panoramas using Gemini 3.5 Flash-Lite. Saved predictions include an explanation for every claim. The app shows each panorama and four enlarged sections, supports live verification, and keeps independent human reference labels separate from submission predictions.

## Run the demo

Use Python 3.10 or newer (the recorded demo environment uses Python 3.10 and the pinned dependencies in requirements.txt).

```powershell
python -m pip install -r requirements.txt
python -m streamlit run app.py
```

Saved results work without an API key. For live inference or regenerating all predictions, set `GEMINI_API_KEY` in the environment or in a local `.env` file. Never commit that file. Live inference sends the selected panorama and claim to Google's Gemini API; it displays a result without changing the saved submission.

The small claim and scene manifests are included in `Dataset/`. Download the official Track A image pack separately and extract it so cited images exist at `Dataset/track_a_panoramas/track_a/panoramas/site_00/scene_00000/color.png` and the corresponding paths for other scenes. The images are deliberately excluded from this package.

## Export and validate

```powershell
python make_submission.py --output submission.json
```

The exporter requires every official claim ID exactly once, one of the three legal verdicts, correct scene membership, and existing cited images. Scene references in saved predictions are converted to the first panorama that the inference pipeline analyzed. `no_evidence` entries may omit citations. Importing the exporter has no file-writing side effects. The app's **Submission** tab downloads the same validated evidence log for **Team 3**.

From the official challenge repository root, run:

```powershell
python scripts/check_submission.py "submissions/Team 3/submission.json"
```

The official checker validates structure and citation membership; it does not establish verdict accuracy. Submit `submissions/Team 3/submission.json` together with this code via the required PR workflow. This package is prepared locally and does not create a PR.

## Scope and limitations

- All 75 Track A claims are answered. Track B is intentionally empty and optional.
- The predictions are zero-shot VLM outputs, not the organizers' authored answers.
- `outputs/reference_labels.csv` contains a small independent human review sample for evaluation only. Saving a reference label does not change the submission.
- Human review disagreements must be resolved by inspecting visible evidence. The submission tab surfaces disagreements without silently replacing AI verdicts.
- Live verification depends on API availability. The saved evidence log and panorama viewer remain usable without network inference.

Data: Rohbau3D, Rauch et al., *Rohbau3D: A Shell Construction Site 3D Point Cloud Dataset*, Scientific Data (2025). Challenge materials: https://github.com/wakecap/contech-hackathon-2026.
