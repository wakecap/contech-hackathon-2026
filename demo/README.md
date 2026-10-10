# Hackathon viewer

Launch demo/start_viewer.bat, then open http://localhost:8811/index.html.

For a new checkout, install the solution dependencies with npm ci in solution, install Python Pillow, and install the challenge panorama pack in data/track_a/panoramas. Run python demo/build_assets.py to generate local previews and data.js before launching. Generated viewer snapshots, imagery and run histories are ignored by Git; the submission JSON is committed separately.

The header switches saved Luna and DeepSeek predictions. Saved run selects previous runs newest first; reasoning is shown when recorded. Current results combine latest results per scene, while historical selection shows only that run.

Rerun images lets you choose scenes, Select all, reasoning effort and passes. It makes fresh provider calls and retains untouched results. Every completed response yields supported, refuted or no_evidence; low confidence is flagged but does not withhold a verdict. API failures remain failed scans.

There is no official answer key in this checkout. No accuracy, reference-match score, provisional AI answer set or human-check workflow is shown. Self-reported confidence is not accuracy.

All 75 claims belong to 24 scenes; the other 24 installed scenes have no claims. Images are local previews and must not be committed. Raw model reports and history are ignored by Git.

Refresh saved outputs without model calls:

```bat
node demo/sync_results.mjs
node demo/model_results.mjs
```

Build the Team 4 submission using node solution/export_submission.mjs. It combines the latest DeepSeek results per claim, including partial reruns. Successful DeepSeek reruns also refresh this export automatically. Incomplete or failed results keep the previous submission file and show a warning; rerun those scenes before submitting. Luna runs remain available for comparison and do not replace the DeepSeek submission. See SUBMISSION.md for the official format. Use scripts/check_submission.py to validate it. This checks structure and citation membership, not correctness.
