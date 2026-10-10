# Prove It — batch vision runner

Run `solution\run_images.bat`. Requires Node.js 22+ and npm (already available on this laptop). The first run installs the locked dependencies, opens **Continue with ChatGPT**, and asks you to authorize this app's ChatGPT plan usage. Subsequent runs reuse the saved connection and refresh it when needed.

The default configuration uses **GPT-6 Luna through the OpenAI SDK with subscription OAuth**, not an API key. Eligibility and available models are checked against the signed-in account. If access is unavailable or your allowance is exhausted, the runner fails visibly; it never switches to paid API billing automatically. You still need to complete the browser sign-in yourself.

Credentials are encrypted with Windows DPAPI in `solution/.local/chatgpt.dpapi`, bound to your Windows user. This directory and `.env` are excluded from Git. No existing Codex credentials are read. One runner at a time avoids refresh-token races. After an interrupted process, remove `.local/runner.lock` only after confirming the runner is no longer running.

Official authentication references: [registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in), [models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference), [account sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions).

## Single-image smoke test

The current default configuration selects five real Track A panoramas and their
15 official claims, copied under `batches/track_a_sample5/`. They span five sites
and all six claim categories. `run_images.bat` uses this selection. The installed
pack is located at `../track_a/panoramas`; it contains 3072×854 panoramas. The
`panorama_strip` preparation sends one overview plus four overlapping full-height
crops, preserving the source geometry rather than guessing the vertical field
of view. No full submission is emitted for this sample. Results will appear in
`results/track_a_sample5/latest.json` after an authorized live run.

The first authorized live run completed all 10 configured model calls: 6 claims
were supported, 5 refuted, and 4 flagged for review. These counts measure model
agreement, not accuracy. Run `node summarize.mjs` to generate `review.md` beside
the results JSON. Successful passes are cached; a normal rerun reuses them.
Use `--fresh` only when deliberately requesting new model calls.

Regenerate this batch with `node prepare_sample.mjs`. For a full run, use the
actual pack location and `panorama_strip` rather than the generic 2:1 settings
shown later in this guide. The user confirmed upload authorization and organiser
permission for cloud processing before this live run.

`sample_images/` contains exactly one PNG: a **synthetic drawing**, plus three test claims in `claims.json`. It tests image input and the output contract; it is not a construction accuracy benchmark.

From the repository directory:

```bat
solution\run_images.bat --dry-run
solution\run_images.bat
```

Dry-run validates and decodes the images without signing in, uploading, or calling a model. The real five-panorama sample has now been tested with both providers.

## Other batches

Edit `config.json` to change `input_dir`, or pass a folder:

```bat
solution\run_images.bat --input "C:\path\to\batch"
```

Images are discovered recursively (PNG, JPEG, WebP, GIF; GIF first frame only). Paths in the configuration and relative `--input` values are resolved beside the configuration file. When the batch has `claims.json`, every image must have claims and every manifest image must exist. Format:

```json
{
  "claims": [
    { "image": "room1.png", "claimId": "window-1", "statement": "Windows are installed." },
    { "image": "subfolder/room2.jpg", "claimId": "plaster-2", "statement": "Internal walls are fully plastered." }
  ]
}
```

Without a manifest, each image gets the `default_claims` in the configuration. Generic batch output is an evidence report, not a hackathon submission.

Use `image_projection: "flat"` for ordinary images and `"equirectangular"` for 2:1 360 panoramas. Panorama mode sends six named perspective views at `face_size` pixels. The Node implementation avoids requiring Python/PyTorch. Face labels describe relative viewing directions, not compass directions. Cube seams and small details still need review on real data.

## Passes and the second model

Set each enabled model's `passes` and `weight` in `config.json`:

```json
{ "id": "luna", "provider": "openai", "auth": "subscription", "model": "gpt-6-luna", "enabled": true, "passes": 3, "weight": 1, "reasoning_effort": "medium" }
```

Passes are fresh independent requests with rotating inspection emphasis. They never see earlier answers. Repeated passes can remain correlated and do not guarantee improved accuracy. They increase inference usage linearly.

To enable DeepSeek:

1. Copy `.env.example` to `.env` and fill `DEEPSEEK_API_KEY` (or supply it through your environment).
2. Set the DeepSeek entry's `enabled` to `true`, and choose its `passes` and `weight`.

The adapter sends the **same images and claims** through the OpenAI SDK's compatible Chat Completions client. Its default model is `deepseek-flash`, documented as image-capable by [DeepSeek](https://api-docs.deepseek.com/guides/vision/). It does not receive Luna's answer. DeepSeek's key and live model access remain to be tested. It uses separate API billing, not your ChatGPT subscription.

This checkout now has DeepSeek enabled and its key saved in the ignored `.env` file. API access still needs a successful live request.

Scoring for each claim:

```
pass points = 100 × confidence, awarded to that pass's chosen verdict
model points[verdict] = sum(pass points[verdict]) / configured model passes
combined points[verdict] = sum(model weight × model points[verdict]) / sum(model weights)
winner share = winner points / sum(points across all three verdicts)
margin = (winner points − runner-up points) / sum(points)
```

Defaults require winner share ≥0.60, margin ≥0.15, and winner points ≥60. Otherwise the result is `needs_review` with a null verdict. These are **starting heuristics**, to tune against a labelled development set. Reported confidence and winner share are not calibrated correctness probabilities. Additional passes do not increase one model's voting weight.

`no_evidence` is a genuine model verdict about visibility. Failed/malformed/incomplete responses produce `error`, not `no_evidence`. Every configured pass must succeed before aggregation. All individual observations, confidence values, scores, disagreement, errors, and available token usage are saved.

## Results and resuming

`results/latest.json` contains the current report; timestamped reports preserve completed runs. Successful passes are cached using image content, claim statements, prompt/schema, preparation settings, and model/pass configuration. Rerunning reuses completed passes and retries failures. Changed images or settings invalidate the cache. Use `--fresh` to deliberately repeat all configured calls. Results may contain descriptions of challenge imagery and are ignored by Git.

Exit codes: `0` completed; `1` setup/input failure; `2` one or more claims need review or retry.

Response text is collected from completed messages or streamed done/delta events,
but accepted only after terminal completion. A single JSON code fence is tolerated;
empty, truncated, or otherwise invalid JSON is rejected. Rejected responses are
saved under `results/diagnostics/` with event counts, without credentials or input
image payloads. Close a running batch before restarting after a code update.

Account commands use the same `.bat` entry point:

```bat
solution\run_images.bat --login
solution\run_images.bat --models
solution\run_images.bat --accounts
solution\run_images.bat --new-account
solution\run_images.bat --account 1
```

## Full Track A

Once the image pack is present, set:

```json
"mode": "track_a",
"input_dir": "../data/track_a/panoramas",
"image_projection": "equirectangular",
"team": "YOUR_TEAM_NAME"
```

The runner groups the official claims by scene and sends all listed panoramas for that scene together. It checks files are readable and maps evidence views back to official scene panorama paths in code. Missing images stop execution before uploads. No model-generated paths are accepted.

A timestamped `results/submission-*.json` is emitted only when every claim is resolved and all configured passes succeeded. Then run the organiser's checker, review whether the imagery truly proves the verdicts, and copy the reviewed file to `submissions/<TEAM>/submission.json`. The organiser's checker validates membership and completeness, but does not inspect image files or judge visual correctness. Track B is not implemented here.

The repository restricts redistribution of challenge imagery. Resolve the organiser's cloud-processing policy before running real challenge images through either provider.

## Offline verification

```bat
cd solution
npm test
```

Tests cover weighted voting, missing passes, evidence validation, panorama orientation, mocked execution/resume, and cache invalidation. They do not contact either model service.
