# "Prove It" — Construction Progress Verification
> **Implementation update — 10 October 2026:** GPT-6 Luna is now the primary
> vision verifier via the OpenAI SDK and documented Sign in with ChatGPT
> subscription OAuth. Gemma and the embedding/ensemble tiebreaker below are
> superseded. `run_images.bat` runs configurable batches; `config.json` controls
> per-model passes and confidence-weighted voting. DeepSeek is now enabled with
> its key in the ignored `.env` file. Both providers completed an authorized
> five-panorama sample: 15 claims, 10 successful model calls, 4 disagreements
> requiring review. The pack is 3072×854, so overlapping panorama crops replace
> the proposed cube projection for this pack.
> See [the current runner guide](README.md).
> Offline tests and a synthetic single-image sample are available; subscription
> sign-in and real model calls are validated; construction accuracy still needs
> evaluation against a labelled development set.
> The original proposal below is retained as historical context.
## Implementation Plan & Current State — prepared for external review

**Prepared:** 10 October 2026
**Event:** Saudi ConTech October Hackathon — Saturday 10 Oct 2026, Staybridge, Al Khobar (KSA). Host: Saudi Arabian Bechtel.
**Repo:** `contech-hackathon-2026` (the official challenge repo)
**Team size:** up to 5
**Deadline:** **code freeze 16:30** event day; submit by PR.

> **Note to reviewer:** this document is self-contained on purpose. You are being
> asked to critique our understanding of the problem and our proposed approach.
> Facts we verified are marked **[verified]**; assumptions **[assumed]**; things
> not yet confirmed **[unverified]**. Explicit review questions are in §9.

---

## 0. TL;DR

- We must build a tool that reads real construction imagery and outputs an
  **evidence log**: for each contractor progress claim, a verdict
  (`supported` / `refuted` / `no_evidence`) **plus the exact image(s) that prove it**.
- **Track A is required** (verify 75 authored claims across 24 Rohbau3D 360°
  panoramas). **Track B is bonus** (ConSLAM change detection, 4 visits, 5 tasks).
- Scoring: 50 pts Track A accuracy, 10 pts citation validity, 40 pts judge panel,
  +15 bonus Track B. A right verdict with a bad citation scores **0**; a correct
  `no_evidence` scores **full marks**.
- Approach: a **local, offline, CPU-only** pipeline — reproject panoramas to flat
  cube faces, then **Qwen3-VL-2B** (via Ollama) reasons over each scene's claims
  in one batched call; unclear cases escalate to a **cloud vision model**
  (available via our OpenCode subscription) as a tie-breaker.
- Two hard constraints found by measurement: **PyTorch is unavailable on Python
  3.15** (blocks the whole HF stack), and **Ollama's `embeddinggemma-2` requires
  MLX** (Apple-only) so it cannot run here. Both are worked around.
- **Biggest risk:** the image packs are **not on the machine yet** — they arrive
  via USB/Drive and gate everything.

---

## 1. The problem statement (as provided by the organisers)

### 1.1 Mission
On construction projects, someone claims progress and someone else must verify
it. Today a human clicks through site imagery. We must automate that check —
and **prove every answer with cited imagery**. If the evidence isn't there, the
tool must say so. Confidently guessing wrong is the main way to lose.

### 1.2 Track A — Verify the claim sheet (Rohbau3D) · **required**
- Real indoor construction scenes from **8 German sites** — 360° panoramas
  rendered from terrestrial laser scans, bare shell → fitted out.
- **Half the scenes carry a claim sheet** (`data/track_a/claims.json`); the rest
  are context.
- For each claim, output:
  `supported` · `refuted` · `no_evidence` — **plus the panorama(s) that prove it**.
- Claims are about **completion state** (plastered / installed / staged / poured).
  **Roughly half are false, and a few are deliberately unanswerable** — honesty is scored.

### 1.3 Track B — "What changed here?" (ConSLAM) · **bonus, optional**
- One London residential project, walked **four times** (2022-04-26, 06-09,
  06-29, 08-03).
- For each zone × visit-pair, report **what work happened** as structured changes
  across categories `facade, partitions, mep_services, finishes,
  materials_logistics, structure`, directions `progressed, added, removed,
  no_change`, each backed by frames from **both** visits.
- Only worth attempting after Track A works. Worth +15 bonus.

### 1.4 Scoring
| Component | Weight | How |
|---|---|---|
| Track A verdict accuracy | 50 | vs. the authored held-out key |
| Citation validity | 10 | cited files exist, belong to the scene; **spot-checked live** for whether the image shows what we claim |
| Judge panel rubric | 40 | business impact · engineering mindset · clarity |
| Track B change detection | **+15 bonus** | per-category F1 vs. authored key; only for teams who cleared Track A |

Key asymmetries:
- A verdict with **invalid citations scores 0 even if correct**.
- A correct **`no_evidence` earns full marks** for that claim.
- **Every verdict needs a cited image** (except `no_evidence`).

### 1.5 The finale (live interrogation)
Judges pick a scene (or zone-pair) and query the tool **live**:
*"How done is this — prove it."* The authored answer is revealed right after.

### 1.6 Rules & constraints
- Teams of up to 5; build on the day; exploring data beforehand is expected.
- Any method is legal (VLMs, classical CV, hybrids). **No starter model on purpose.**
- Both datasets are public; the claim sheets and change keys are authored/private.
- **Out of scope:** dashboards, earned value, payments, forecasting, viewers.
- **Imagery restriction:** frames may show site personnel; use imagery for this
  challenge only; **do not redistribute or post it.**
- Deadline: **code freeze 16:30**; PR with `submissions/<TEAM_NAME>/submission.json` + code; must pass `scripts/check_submission.py`.

### 1.7 Agenda (event day)
11:00 welcome/brief → 12:00 build starts → **16:30 code freeze** →
16:45 pitches (6 × 10 min + live test) → 18:00 judges → 18:30 results.

---

## 2. Data we have locally

`data/track_a/`
- `claims.json` — **75 claims** `{claimId, sceneId, statement, category}`. **[verified]**
- `scenes.json` — **48 scenes** `{sceneId, site, scene, panoramas:[...]}`; 24 scenes carry claims. **[verified]**
- `panoramas/<site>/<scene>/color.png` — **NOT PRESENT** (image pack; 4096×2048 equirect). **[verified missing]**

`data/track_b/`
- `tasks.json` — **5 tasks** (zone × visit-pair) with `frames.before` / `frames.after`. **[verified]**
- `zones.json` — **2 zones** (`zone_corridor`, `zone_03`) with centers/radius and per-visit frame lists. **[verified]**
- `poses/<sequence>/<ts>.txt` — **1610** 4×4 pose matrices. **[verified]**
- `frames/<sequence>/<name>.png` — **NOT PRESENT** (image pack; 2064×1544). **[verified missing]**

**Claim distribution (Track A):**
| Category | Claims | | Site | Claims |
|---|---|---|---|---|
| finishes | 28 | | site_00 | 18 |
| mep_services | 22 | | site_01 | 15 |
| facade | 10 | | site_03 | 9 |
| structure | 7 | | site_05 | 8 |
| partitions | 5 | | site_08 | 8 |
| materials_logistics | 3 | | site_09 | 7 |
| | | | site_02 | 6 |
| | | | site_12 | 4 |

**Data caveats (from the brief):**
1. Track A panoramas are **renders of laser scans** — moving objects ghost, glass
   and shiny surfaces can drop out. If a claim can't be judged → `no_evidence`.
2. Track B frames are **dark** (machine-vision, no tone mapping) — normalize exposure.
3. A **zone is a place, not a viewpoint** — frames look in different directions;
   use poses/overlap to reason.
4. Both datasets public; we may pull more scenes, but the scored keys are authored/private.
5. Rohbau3D public release includes **semantic labels** (object categories, not completion states).

**Image packs:** via `scripts/download_data.py` (Google Drive) and on a **USB stick
at the venue**. Sizes: track_a panoramas ≈ 310 MB, track_b frames ≈ 1.5 GB. **[verified]**

---

## 3. Target machine (verified via inspection)

| Component | Value | Implication |
|---|---|---|
| CPU | Intel **i5-13420H**, 8C/12T, AVX2 (no AVX-512) | fine for small quantized models |
| RAM | **15.7 GB total, ~5.3 GB free** at rest | tight; must close apps; ≤2B models |
| GPU | **Intel UHD (integrated), no CUDA** | CPU-only inference |
| Disk | 884 GB free | ample |
| OS | Windows (Huawei laptop) | Windows toolchain |
| Python | **3.15.0** (released 2026-10-09) | **`torch` has no 3.15 wheel** → PyTorch/HF blocked |
| Network | present but **flaky/slow** (~10 MB/s, 15 s timeouts) | downloads are the risk |

**Implication:** we avoid the PyTorch / `transformers` / `sentence-transformers`
route (`pip install torch` fails: "no matching distribution") and run models via
**Ollama** (self-contained C++ runtime, no Python wheels).

---

## 4. Tooling status

| Item | Status |
|---|---|
| Ollama 0.40.2 | ✅ installed, serving on 127.0.0.1:11434 |
| `numpy` 2.5.3 + `Pillow` 12.3.0 | ✅ installed (cp315 wheels exist) |
| **`qwen3-vl:2b`** | ✅ **installed (1.9 GB)** |
| Panorama tiler | ✅ written + self-tested: 4096×2048 → six cube faces + contact sheet in **0.71 s** |
| **Vision smoke test (Qwen3-VL-2B, CPU)** | ✅ **works** — see numbers below |
| `embeddinggemma-2` | ❌ **cannot run** — Ollama build requires **MLX** (Apple-only) |
| `gemma3:4b` | ⛔ cancelled — 4B too heavy for ~5.3 GB free RAM |
| Model client / escalation / submission emitter | ⏳ not built yet |
| Image packs (track_a/track_b) | ❌ **not present** (USB/Drive on the day) |
| OpenCode `opencode` CLI on PATH | ❌ not found in shell (server API exists; endpoint/auth not exposed) |

**First real measurement [verified]** — Qwen3-VL-2B on this CPU, one contact-sheet
image (six 512 px cube faces), asking for a one-sentence description:

| Metric | Value |
|---|---|
| Model load | 4.1 s |
| **Vision prefill (image encode)** | **1,660 tokens / 45.3 s** |
| Generation | 602 tokens / 41.8 s → **14.4 tok/s** |
| Total round trip | 91.4 s |

**Interpretation:** generation speed is fine; **vision prefill dominates.** So:
1. **Batch claims per scene** — encode a scene's contact sheet *once* and answer
   all of that scene's claims in a single call (24 scenes, not 75 calls).
2. **Cap output tokens** — 602 tokens was self-indulgent; a strict JSON schema
   with ~60–100 tokens/verdict cuts generation to a few seconds.

Projected: ~24 scene calls × (≈45 s encode + ≈10 s generation) ≈ **25–35 min**
for a full Track A pass — comfortable inside the build window, with room to re-run
a subset for accuracy iteration.

---

## 5. Proposed architecture

```
 equirect panorama (4096×2048)
        │  §5.1 tiler: reproject → 6 flat cube faces + 1 contact sheet
        ▼
 ┌──────────────────── claim taxonomy (§5.2) ────────────────────┐
 │ claim → {category, target_object, state_predicate, polarity}   │
 └────────────────────────────────────────────────────────────────┘
        │
        ▼
 ┌──────────────── local CPU (Ollama), ONE CALL PER SCENE ────────────────┐
 │  contact sheet + ALL claims for that scene                             │
 │  → Qwen3-VL-2B → JSON: [{claimId, verdict, tile, confidence, why}]     │
 │  (amortizes the ~45 s vision encode across the scene's claims)         │
 └────────────────────────────────────────────────────────────────────────┘
        │                                   │
        ▼                                   ▼
 Track A submission                 Track B: poses pair before/after →
 (§5.5 emitter + checker)           VLM describes change per category
        │
        ▼
 ESCALATION (§5.4): if local confidence is low / verdict ambiguous →
 cloud tie-breaker (subscription vision model: GPT-6 Luna / Gemini 3.8
 Flash / DeepSeek V4 Flash Vision Exp) — only if network + clearance.
```

### 5.1 Tiler (`solution/tiler.py`) — **built & tested**
Equirect panoramas distort badly at the poles, so we reproject to **six flat 90°
cube faces** (front/right/back/left/up/down) plus a **contact sheet** (one image
the model reasons over globally). Pure numpy+Pillow, no GPU. Verified: 4096×2048 →
six 512 px faces + contact sheet in 0.71 s.

### 5.2 Claim taxonomy
Normalize every free-text claim into structured fields, e.g.:
- *"Windows are installed in this room."* → `{category: facade, target: window,
  state: installed, polarity: positive}`
- *"Window openings are still open to the weather."* → `{category: facade,
  target: window_opening, state: open, polarity: **negative**}`

Why: (a) consistent, category-specific prompts; (b) separates object presence
from state reasoning; (c) makes per-claim verdicts comparable across calls;
(d) exposes **polarity traps** (`"still open"`, `"remains unclosed"`).

### 5.3 Decision engine (scene-batched)
One call per scene: contact sheet + the scene's claims → strict JSON verdicts.
Single client abstraction so the same code talks to **local Ollama** *or* a
**cloud endpoint**. Prompt explicitly instructs: *if the relevant area is not
visible in any face, answer `no_evidence`.* Output capped with a JSON schema.

### 5.4 Confidence & escalation (no local embedder)
With the multimodal embedder off the table (MLX), confidence comes from:
1. **Model self-reported confidence** per verdict (0–1), and
2. **Expected-agreement signals**: does the model name a face/region for the
   object; is the object category even present in the scene?

Policy:
- **High confidence** → emit verdict + cited face.
- **Low confidence / ambiguous** → escalate to the **cloud tie-breaker**; if cloud
  is unavailable, emit `no_evidence` (honest, full marks).
- **Object clearly absent** → `refuted` for "installed" claims or `no_evidence`
  for occlusion claims, per taxonomy.

### 5.5 Submission emitter
Assemble `submission.json`; run `scripts/check_submission.py` until it passes.
Citation = valid panorama path from that claim's scene (Track A), or before/after
frames from the task lists (Track B).

### 5.6 Track B
Use the provided **poses** to match a "before" frame to the nearest-view "after"
frame (same direction), then ask the VLM to describe the change per category.
Bonus only — after Track A passes.

---

## 6. Model choice (with evidence)

**Public benchmark rationale — MMMU (val), vision reasoning, Sept 2026:**

| Model | Size | MMMU (val) |
|---|---|---|
| Qwen3-VL-8B Thinking | 9B | 0.741 |
| Qwen3-VL-4B Thinking | 4B | 0.708 |
| **Qwen3-VL-4B Instruct** | 4B | **0.674** |
| Gemma 3 27B | 27B | 0.649 |
| Gemma 3 12B | 12B | 0.596 |
| Gemma 3 4B | 4B | 0.488 |

At the size we can run on CPU, **Qwen3-VL leads Gemma on vision reasoning** (a 4B
Qwen beats a 27B Gemma). We run **Qwen3-VL-2B** (1.9 GB, verified working) for
RAM headroom. Gemma's theoretical edge was in embeddings, but the two Gemma
routes we wanted are both blocked here: `embeddinggemma-2` needs **MLX**, and the
torch route needs a Python ≤3.14. So we use a **cloud tie-breaker** instead.

**Subscription vision models available to us [verified in catalog]:**
| Model | Cost (in/out per M tok) | Note |
|---|---|---|
| DeepSeek V4 Flash Vision Exp | $0.15 / $0.60 | explicitly a vision model |
| GPT-6 Luna | $0.10 / $0.50 | **[unverified]** vision assumed |
| GPT-5.6 Luna | $0.20 / $1.20 | |
| Gemini 3.8 Flash | — | strong vision, **[unverified]** |
| Claude Sonnet/Opus 5.5 | — | strong reasoning |
| Qwen3.8 Max / Flash | $2/6 , $0.15/0.47 | multimodal |

Workload cost is negligible (24 scenes, perhaps 100–200 image calls tip → cents).

---

## 7. Execution plan

**Serial path:** image packs → tiler → per-scene Qwen calls → escalation →
emitter → PR. Everything gates on the image packs.

**Suggested team split (5):**
1. **Data/ingestion** — unpack packs; run tiler; Track B exposure normalization + pose matching.
2. **Decision engine** — scene-batched client, taxonomy prompts, JSON schema, escalation.
3. **Evidence/harness** — citation validity, emitter, `check_submission.py`, self-scoring.
4. **Eval** — hand-label a small dev set; error analysis; tune confidence thresholds.
5. **Pitch/demo + Track B** — panel story + live interrogation; Track B after A passes.

**Timeline from 12:00:** 12:00–12:30 unpack+schema; 12:30–14:00 first end-to-end
verdicts + valid submission; 14:00–15:30 accuracy iteration; 15:30–16:15 freeze +
checker + pitch; **16:30 submit**.

---

## 8. Risks & unknowns

1. **Image packs absent** — everything is blocked until USB/Drive. *(top risk)*
2. **Vision prefill cost (measured 45 s/scene)** — mitigated by per-scene batching
   and capped output; net ~25–35 min for 75 claims.
3. **RAM pressure** — ~5.3 GB free; 2B model only (~2–3 GB peak). Must close apps.
4. **Flaky network** — model downloads already failed twice; cloud tie-breaker
   may be unavailable.
5. **Python 3.15 / no torch** and **EmbeddingGemma MLX-only** — both block the
   embedding layer; worked around by dropping it.
6. **Cloud tie-breaker reachability** — subscription API is real but the OpenCode
   CLI/endpoint is not exposed in our shell; integration is unproven. **[unverified]**
7. **Privacy/ToS** — brief says do not redistribute imagery; cloud calls may
   constitute redistribution. **Should confirm with organisers.**
8. **`no_evidence` calibration** — over-use loses points; under-use loses more.
9. **Benchmark ≠ our task** — MMMU is a prior, not proof on plastering/ductwork;
   need a small labelled dev set.
10. **Track B alignment** — pose→frame timestamp matching must be correct.

---

## 9. Questions for the reviewer

1. **Architecture:** Is a local CPU-only 2B VLM + cloud tie-breaker the right
   shape given ~4.5 build hours and a 16 GB CPU-only laptop? What would you cut?
2. **Scene-batching:** Is one call per scene (all its claims at once) the right
   trade-off vs. one call per claim, given the 45 s vision prefill?
3. **Taxonomy:** Does `{category, target, state, polarity}` actually reduce errors
   here? Would you add/remove fields?
4. **`no_evidence` policy:** With wrong=0 and correct-`no_evidence`=full, what is
   the optimal decision rule without labels? How to set the confidence threshold?
5. **Confidence without an embedder:** We lost the multimodal embedder. Is a
   model self-confidence score reliable enough to gate cloud escalation, or is
   there a better cheap signal?
6. **Citations:** Since a right verdict with a bad citation scores 0, how would you
   make citation validity bulletproof (existence + scene membership + live spot-check)?
7. **Cloud vs local:** Worth the cloud tie-breaker given the privacy/"do not
   redistribute" rule, or is local-only the intended path?
8. **Track B:** Bonus-only — attempt it, or put all slack into Track A + panel?
9. **Panel score (40 pts):** What framing wins business impact / engineering /
   clarity, and how should the live interrogation be rehearsed?
10. **Anything obviously wrong or missing.**

---

## Appendix A — Submission schema (`submission.json`)

```json
{
  "team": "TEAM_NAME",
  "track_a": [
    { "claimId": "A-0032", "verdict": "refuted",
      "evidence": ["site_01/scene_01016/color.png"],
      "rationale": "Door openings have no leaves hung." },
    { "claimId": "A-0018", "verdict": "no_evidence",
      "rationale": "Claim area is behind the scanner position." }
  ],
  "track_b": [
    { "taskId": "B-zone_03-4to5",
      "changes": [
        { "category": "mep_services", "direction": "added",
          "note": "New containment runs at soffit.",
          "evidence": { "before": ["sequence4/…png"], "after": ["sequence5/…png"] } },
        { "category": "structure", "direction": "no_change" }
      ] }
  ]
}
```

**Checker rules (`scripts/check_submission.py`):**
- All 75 Track A claims answered exactly once.
- `supported`/`refuted` require ≥1 evidence file that is a real panorama of that
  claim's scene; `no_evidence` needs none.
- Track B optional; non-`no_change` changes need frames from **both** visits drawn
  from that task's lists; omitted category = `no_change`.

## Appendix B — Environment facts recap

- i5-13420H, 8C/12T, AVX2 · 15.7 GB RAM (~5.3 GB free) · Intel UHD iGPU (no CUDA) · 884 GB disk.
- Python 3.15.0 (`torch` unavailable) · numpy 2.5.3 · Pillow 12.3.0.
- Ollama 0.40.2 @ 127.0.0.1:11434 · `qwen3-vl:2b` installed (1.9 GB).
- Tiler verified: 6 cube faces + contact sheet, 0.71 s/panorama.
- Qwen3-VL-2B vision verified: prefill 1660 tok / 45.3 s, gen 14.4 tok/s.

## Appendix C — Work completed so far

- Read all four docs (`README.md`, `DATA.md`, `SUBMISSION.md`, `participant_brief.html`).
- Inspected all task data (75 claims, 48 scenes, 5 Track B tasks, 2 zones, 1610 poses).
- Profiled the target machine (CPU/RAM/GPU/disk/Python/network).
- Installed Ollama + numpy + Pillow; installed `qwen3-vl:2b`.
- Wrote and self-tested the panorama tiler (`solution/tiler.py`).
- Ran the first vision smoke test on CPU and measured throughput.
- Ruled out `embeddinggemma-2` (MLX-only) and `gemma3:4b` (RAM).
- **Nothing submitted yet; code freeze is 16:30.**
