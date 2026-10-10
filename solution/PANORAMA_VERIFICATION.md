# Panorama ingestion verification

## What is established

- OpenAI explicitly documents panoramic/fisheye images as a vision limitation,
  and supports multiple images in a single request. See the
  [official vision guide](https://developers.openai.com/api/docs/guides/images-vision).
- DeepSeek documents multi-image inputs and image detail handling in its
  [vision guide](https://api-docs.deepseek.com/guides/vision/).
- The [Rohbau3D author repository](https://github.com/RauchLukas/Rohbau3D)
  documents configurable panorama rendering and cube-map rendering from the
  original point clouds. It does not establish how this event's resized or
  cropped 3072×854 PNGs were produced.
- All five local sample files are 3072×854 with no EXIF or XMP projection
  metadata. Their aspect ratio alone cannot distinguish cropping from
  nonuniform resizing or establish latitude bounds.
- Splitting PNGs does not undo panorama distortion. The rationale is preserving
  detail and reducing the breadth of each local view while retaining an overview.
  No claim is made about what either model's training data contained.

## Implemented experiment

The default remains an overview plus four 1024×854 overlapping crops, with only
DeepSeek enabled. OpenAI is disabled in both configurations at the user's request.
Its first run has 15 claims: 6 supported, 5 refuted, 4 needing review.

`config.crop-trial.json` uses the same five images, claims, prompts, model settings,
and voting thresholds, but changes preparation to:

- One overview.
- Five full-height 768×854 crops with 25% horizontal overlap.
- One 768×854 seam crop made from the last 384 and first 384 source columns.

Each view retains explicit source pixel regions. No perspective reprojection or
guessed vertical field of view is used. `export_views.mjs` exports the exact image
payloads and a contact sheet without network access or credential loading.

The offline regression suite checks crop coverage, dimensions, seam ordering and
pixel preservation, together with response handling and voting. All 12 tests pass.
The experimental configuration also passes its five-image/15-claim dry run.

After explicit approval for the derived views, the trial completed using DeepSeek
only: all five calls succeeded, 7 claims were supported, 7 refuted, and 1 fell below
the confidence threshold. Across all 15 claims, DeepSeek's categorical verdicts
were identical to its earlier wider-crop answers. Reported confidence varied;
there is no measured accuracy improvement. The prior results are preserved in
`results/track_a_sample5/`; trial results and the comparison are in the separate
`results/track_a_crop_trial/` directory. Use `node compare_runs.mjs` to generate
the comparison report.

## Limits of the comparison

No private answer key is available. Changed verdicts, higher confidence, or fewer
disagreements would not establish improved accuracy. One pass per configuration
also mixes preprocessing effects with model sampling variation. Before promoting
the experimental preparation, review both sets of evidence against independent
human labels and compare category errors, abstention, input tokens, and latency.

## Commands

```bat
node solution\export_views.mjs
solution\run_images.bat --config config.crop-trial.json --dry-run
solution\run_images.bat --config config.crop-trial.json
```

Only the last command uploads imagery. The production crop size
has not been switched to the experiment.
