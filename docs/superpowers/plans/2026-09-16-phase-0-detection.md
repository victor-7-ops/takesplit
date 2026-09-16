# Phase 0 Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the rehearsal-splitting algorithm works on real audio, with a per-clip confidence score, before any app or backend code is written.

**Architecture:** A pure detection module (`detect.py`) takes raw sample arrays and returns segments with `start_sec`/`end_sec`/`kind`/`confidence`/`confidence_tier` — no file or network I/O, per `HANDOFF.md` §14. A thin `audio.py` wraps `ffmpeg`/wave-file I/O. A CLI script (`scripts/split_local.py`) wires them together for local testing against real KTD rehearsal recordings.

**Tech Stack:** Python 3.12, numpy, matplotlib (waveform PNG), pytest. `ffmpeg` as an external system dependency (already on Victor's Phase-0 checklist in `HANDOFF.md` §15).

---

## File Structure

```
services/worker/
├── pyproject.toml
├── app/
│   ├── __init__.py
│   ├── detect.py       # pure: arrays in, segments out
│   └── audio.py        # ffmpeg subprocess + wav I/O
├── scripts/
│   └── split_local.py  # Phase 0 CLI
└── tests/
    ├── __init__.py
    ├── fixtures.py      # synthetic audio generators
    ├── test_detect.py
    └── test_audio.py
```

`detect.py` owns all math (frame energy, smoothing, thresholding, region merging, confidence scoring). `audio.py` owns everything that touches disk or subprocess (`ffmpeg` normalize/cut, wav read). `scripts/split_local.py` is the only place that calls both and writes output files — this keeps `detect.py` trivially testable with plain numpy arrays, per `HANDOFF.md`'s "pure detection logic" rule.

---

## Task 1: Worker project scaffold

**Files:**
- Create: `services/worker/pyproject.toml`
- Create: `services/worker/app/__init__.py`
- Create: `services/worker/tests/__init__.py`

- [ ] **Step 1: Create `pyproject.toml`**

```toml
[project]
name = "takesplit-worker"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "numpy>=1.26",
    "matplotlib>=3.8",
]

[project.optional-dependencies]
dev = ["pytest>=8.0"]

[tool.pytest.ini_options]
pythonpath = ["."]
```

- [ ] **Step 2: Create empty package markers**

`services/worker/app/__init__.py`:
```python
```

`services/worker/tests/__init__.py`:
```python
```

- [ ] **Step 3: Install and verify**

Run:
```bash
cd services/worker
python -m venv .venv
```

On Windows (PowerShell):
```powershell
.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
```

Expected: numpy, matplotlib, pytest install without error.

- [ ] **Step 4: Commit**

```bash
git add services/worker/pyproject.toml services/worker/app/__init__.py services/worker/tests/__init__.py
git commit -m "chore(worker): scaffold Python project"
```

---

## Task 2: Synthetic audio fixtures

**Files:**
- Create: `services/worker/tests/fixtures.py`

No TDD here — this is test infrastructure, not behavior under test. Write directly.

- [ ] **Step 1: Write fixture generators**

```python
import numpy as np

SAMPLE_RATE = 16000


def tone(duration_sec: float, freq: float = 440.0, amplitude: float = 0.5, sample_rate: int = SAMPLE_RATE) -> np.ndarray:
    t = np.linspace(0, duration_sec, int(sample_rate * duration_sec), endpoint=False)
    return amplitude * np.sin(2 * np.pi * freq * t)


def noise(duration_sec: float, amplitude: float = 0.01, sample_rate: int = SAMPLE_RATE, seed: int = 0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    return amplitude * rng.standard_normal(int(sample_rate * duration_sec))


def concat(*segments: np.ndarray) -> np.ndarray:
    return np.concatenate(segments)
```

- [ ] **Step 2: Verify it imports cleanly**

Run:
```bash
python -c "from tests import fixtures; print(fixtures.tone(1.0).shape)"
```

Expected: `(16000,)` printed, no error.

- [ ] **Step 3: Commit**

```bash
git add services/worker/tests/fixtures.py
git commit -m "test(worker): add synthetic audio fixture generators"
```

---

## Task 3: Frame energy and smoothing

**Files:**
- Create: `services/worker/app/detect.py`
- Test: `services/worker/tests/test_detect.py`

- [ ] **Step 1: Write the failing tests**

```python
import numpy as np

from app import detect
from tests import fixtures


def test_frame_rms_db_louder_signal_has_higher_db():
    quiet = fixtures.tone(1.0, amplitude=0.05)
    loud = fixtures.tone(1.0, amplitude=0.5)
    quiet_db = detect.frame_rms_db(quiet, fixtures.SAMPLE_RATE, frame_ms=100)
    loud_db = detect.frame_rms_db(loud, fixtures.SAMPLE_RATE, frame_ms=100)
    assert np.all(loud_db > quiet_db)


def test_frame_rms_db_frame_count_matches_duration():
    samples = fixtures.tone(2.0)
    frame_db = detect.frame_rms_db(samples, fixtures.SAMPLE_RATE, frame_ms=100)
    assert len(frame_db) == 20


def test_frame_rms_db_handles_silence_without_error():
    samples = np.zeros(fixtures.SAMPLE_RATE)
    frame_db = detect.frame_rms_db(samples, fixtures.SAMPLE_RATE, frame_ms=100)
    assert np.all(np.isfinite(frame_db))


def test_smooth_median_removes_single_frame_spike():
    frame_db = np.array([-40.0, -40.0, -5.0, -40.0, -40.0])
    smoothed = detect.smooth_median(frame_db, frame_ms=100, smooth_sec=0.3)
    assert smoothed[2] < -5.0
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/worker && pytest tests/test_detect.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.detect'` (file doesn't exist yet).

- [ ] **Step 3: Implement `frame_rms_db` and `smooth_median`**

Create `services/worker/app/detect.py`:

```python
import numpy as np

DEFAULT_PARAMS = {
    "frame_ms": 100,
    "smooth_sec": 1.0,
    "threshold_ratio": 0.35,
    "min_gap_sec": 4.0,
    "min_take_sec": 40.0,
    "pad_sec": 1.0,
    "confidence_weights": {"threshold": 0.4, "gap": 0.3, "duration": 0.3},
}


def frame_rms_db(samples: np.ndarray, sample_rate: int, frame_ms: int) -> np.ndarray:
    frame_len = int(sample_rate * frame_ms / 1000)
    n_frames = len(samples) // frame_len
    trimmed = samples[: n_frames * frame_len]
    frames = trimmed.reshape(n_frames, frame_len)
    rms = np.sqrt(np.mean(frames.astype(np.float64) ** 2, axis=1))
    rms = np.maximum(rms, 1e-10)
    return 20 * np.log10(rms)


def smooth_median(frame_db: np.ndarray, frame_ms: int, smooth_sec: float) -> np.ndarray:
    window = max(1, int(round(smooth_sec * 1000 / frame_ms)))
    if window % 2 == 0:
        window += 1
    if window <= 1:
        return frame_db.copy()
    pad = window // 2
    padded = np.pad(frame_db, (pad, pad), mode="edge")
    out = np.empty_like(frame_db)
    for i in range(len(frame_db)):
        out[i] = np.median(padded[i : i + window])
    return out
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_detect.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add services/worker/app/detect.py services/worker/tests/test_detect.py
git commit -m "feat(worker): add frame energy and smoothing functions"
```

---

## Task 4: Threshold, active regions, gap merging

**Files:**
- Modify: `services/worker/app/detect.py`
- Modify: `services/worker/tests/test_detect.py`

- [ ] **Step 1: Write the failing tests**

Append to `test_detect.py`:

```python
def test_compute_threshold_is_between_floor_and_ceiling():
    frame_db = np.array([-40.0] * 10 + [-5.0] * 90)
    noise_floor, music_level, threshold = detect.compute_threshold(frame_db, threshold_ratio=0.35)
    assert noise_floor < threshold < music_level


def test_find_active_regions_detects_single_burst():
    frame_db = np.array([-40.0] * 5 + [-5.0] * 10 + [-40.0] * 5)
    regions = detect.find_active_regions(frame_db, threshold_db=-20.0, frame_ms=100)
    assert regions == [(0.5, 1.5)]


def test_find_active_regions_empty_when_all_below_threshold():
    frame_db = np.array([-40.0] * 20)
    regions = detect.find_active_regions(frame_db, threshold_db=-20.0, frame_ms=100)
    assert regions == []


def test_merge_regions_joins_close_regions():
    regions = [(0.0, 5.0), (6.0, 10.0)]
    merged = detect.merge_regions(regions, min_gap_sec=4.0)
    assert merged == [(0.0, 10.0, 1.0)]


def test_merge_regions_keeps_far_regions_separate():
    regions = [(0.0, 5.0), (12.0, 15.0)]
    merged = detect.merge_regions(regions, min_gap_sec=4.0)
    assert merged == [(0.0, 5.0, None), (12.0, 15.0, None)]


def test_merge_regions_empty_input():
    assert detect.merge_regions([], min_gap_sec=4.0) == []
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_detect.py -v`
Expected: FAIL with `AttributeError: module 'app.detect' has no attribute 'compute_threshold'`.

- [ ] **Step 3: Implement the three functions**

Append to `services/worker/app/detect.py`:

```python
def compute_threshold(frame_db: np.ndarray, threshold_ratio: float) -> tuple[float, float, float]:
    noise_floor_db = float(np.percentile(frame_db, 10))
    music_level_db = float(np.percentile(frame_db, 90))
    threshold_db = noise_floor_db + (music_level_db - noise_floor_db) * threshold_ratio
    return noise_floor_db, music_level_db, threshold_db


def find_active_regions(frame_db: np.ndarray, threshold_db: float, frame_ms: int) -> list[tuple[float, float]]:
    active = frame_db >= threshold_db
    regions = []
    start = None
    for i, is_active in enumerate(active):
        if is_active and start is None:
            start = i
        elif not is_active and start is not None:
            regions.append((start, i))
            start = None
    if start is not None:
        regions.append((start, len(active)))
    frame_sec = frame_ms / 1000
    return [(round(s * frame_sec, 3), round(e * frame_sec, 3)) for s, e in regions]


def merge_regions(regions: list[tuple[float, float]], min_gap_sec: float) -> list[tuple[float, float, float | None]]:
    if not regions:
        return []
    merged = [[regions[0][0], regions[0][1], None]]
    for start, end in regions[1:]:
        prev_start, prev_end, prev_gap = merged[-1]
        gap = round(start - prev_end, 3)
        if gap < min_gap_sec:
            merged[-1][1] = end
            merged[-1][2] = gap if prev_gap is None else min(prev_gap, gap)
        else:
            merged.append([start, end, None])
    return [tuple(m) for m in merged]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_detect.py -v`
Expected: 10 passed.

- [ ] **Step 5: Commit**

```bash
git add services/worker/app/detect.py services/worker/tests/test_detect.py
git commit -m "feat(worker): add threshold, active region, and gap merge logic"
```

---

## Task 5: Confidence scoring helpers

**Files:**
- Modify: `services/worker/app/detect.py`
- Modify: `services/worker/tests/test_detect.py`

This is the confidence-score feature from `docs/superpowers/specs/2026-09-16-clip-confidence-score-design.md` §1. These are the two "confidence-specific fixtures" required by the phase 0 acceptance bar: one proving a boundary right at the threshold scores low, one proving a boundary far from all margins scores high.

- [ ] **Step 1: Write the failing tests**

Append to `test_detect.py`:

```python
def test_boundary_threshold_margin_at_threshold_is_zero():
    frame_db = np.array([-40.0, -40.0, -10.0, -10.0])
    margin = detect.boundary_threshold_margin(
        frame_db, start_sec=0.2, end_sec=0.3, frame_ms=100,
        threshold_db=-10.0, noise_floor_db=-40.0, music_level_db=-10.0,
    )
    assert margin == 0.0


def test_boundary_threshold_margin_far_from_threshold_is_one():
    frame_db = np.array([-40.0, -40.0, -5.0, -5.0])
    margin = detect.boundary_threshold_margin(
        frame_db, start_sec=0.2, end_sec=0.4, frame_ms=100,
        threshold_db=-40.0, noise_floor_db=-40.0, music_level_db=-5.0,
    )
    assert margin == 1.0


def test_gap_confidence_margin_no_gap_is_confident():
    assert detect.gap_confidence_margin(None, min_gap_sec=4.0) == 1.0


def test_gap_confidence_margin_at_cutoff_is_confident():
    assert detect.gap_confidence_margin(4.0, min_gap_sec=4.0) == 1.0


def test_gap_confidence_margin_zero_gap_is_unconfident():
    assert detect.gap_confidence_margin(0.0, min_gap_sec=4.0) == 0.0


def test_gap_confidence_margin_halfway():
    assert detect.gap_confidence_margin(2.0, min_gap_sec=4.0) == 0.5


def test_duration_confidence_margin_at_minimum_is_confident():
    assert detect.duration_confidence_margin(40.0, min_take_sec=40.0) == 1.0


def test_duration_confidence_margin_capped_above_minimum():
    assert detect.duration_confidence_margin(80.0, min_take_sec=40.0) == 1.0


def test_duration_confidence_margin_halfway():
    assert detect.duration_confidence_margin(20.0, min_take_sec=40.0) == 0.5


def test_composite_confidence_all_confident_is_one():
    weights = {"threshold": 0.4, "gap": 0.3, "duration": 0.3}
    assert detect.composite_confidence(1.0, 1.0, 1.0, weights) == 1.0


def test_composite_confidence_all_unconfident_is_zero():
    weights = {"threshold": 0.4, "gap": 0.3, "duration": 0.3}
    assert detect.composite_confidence(0.0, 0.0, 0.0, weights) == 0.0


def test_composite_confidence_weighted_average():
    weights = {"threshold": 0.4, "gap": 0.3, "duration": 0.3}
    score = detect.composite_confidence(1.0, 0.0, 0.0, weights)
    assert score == 0.4


def test_confidence_tier_high():
    assert detect.confidence_tier(0.7) == "high"
    assert detect.confidence_tier(1.0) == "high"


def test_confidence_tier_medium():
    assert detect.confidence_tier(0.4) == "medium"
    assert detect.confidence_tier(0.69) == "medium"


def test_confidence_tier_low():
    assert detect.confidence_tier(0.0) == "low"
    assert detect.confidence_tier(0.39) == "low"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_detect.py -v`
Expected: FAIL with `AttributeError: module 'app.detect' has no attribute 'boundary_threshold_margin'`.

- [ ] **Step 3: Implement the confidence functions**

Append to `services/worker/app/detect.py`:

```python
def boundary_threshold_margin(
    frame_db: np.ndarray,
    start_sec: float,
    end_sec: float,
    frame_ms: int,
    threshold_db: float,
    noise_floor_db: float,
    music_level_db: float,
) -> float:
    frame_sec = frame_ms / 1000
    span = max(music_level_db - noise_floor_db, 1e-6)
    last_idx = len(frame_db) - 1
    idxs = [
        min(max(int(round(start_sec / frame_sec)), 0), last_idx),
        min(max(int(round(end_sec / frame_sec)) - 1, 0), last_idx),
    ]
    margins = [min(1.0, abs(float(frame_db[i]) - threshold_db) / span) for i in idxs]
    return float(min(margins))


def gap_confidence_margin(gap_used_sec: float | None, min_gap_sec: float) -> float:
    if gap_used_sec is None:
        return 1.0
    return float(min(1.0, gap_used_sec / min_gap_sec))


def duration_confidence_margin(duration_sec: float, min_take_sec: float) -> float:
    return float(min(1.0, duration_sec / min_take_sec))


def composite_confidence(
    threshold_margin: float, gap_margin: float, duration_margin: float, weights: dict
) -> float:
    return float(
        weights["threshold"] * threshold_margin
        + weights["gap"] * gap_margin
        + weights["duration"] * duration_margin
    )


def confidence_tier(score: float) -> str:
    if score >= 0.7:
        return "high"
    if score >= 0.4:
        return "medium"
    return "low"
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_detect.py -v`
Expected: 24 passed.

- [ ] **Step 5: Commit**

```bash
git add services/worker/app/detect.py services/worker/tests/test_detect.py
git commit -m "feat(worker): add clip confidence scoring functions"
```

---

## Task 6: `detect_segments` orchestration + hard-case tests

**Files:**
- Modify: `services/worker/app/detect.py`
- Modify: `services/worker/tests/test_detect.py`

This wires every function from Tasks 3–5 into the single entry point the CLI (and later the worker) will call, and proves it against the 5 hard cases from `HANDOFF.md` §8.

- [ ] **Step 1: Write the failing hard-case tests**

Append to `test_detect.py`. Every fixture below uses `amplitude=0.01` for background noise (simulates room tone, not digital silence — needed so the 10th-percentile noise floor is set correctly) and keeps at least ~10% of each clip at that level so percentile math lands where expected.

```python
def test_detect_segments_quiet_intro_does_not_split():
    audio = fixtures.concat(
        fixtures.noise(5.0, amplitude=0.01),
        fixtures.tone(8.0, amplitude=0.06),
        fixtures.tone(50.0, amplitude=0.4),
        fixtures.noise(5.0, amplitude=0.01),
    )
    segments = detect.detect_segments(audio, fixtures.SAMPLE_RATE)
    assert len(segments) == 1
    assert segments[0]["kind"] == "take"


def test_detect_segments_talk_near_quiet_playing_stays_separate():
    audio = fixtures.concat(
        fixtures.tone(50.0, amplitude=0.4),
        fixtures.noise(6.0, amplitude=0.01),
        fixtures.tone(8.0, amplitude=0.06),
        fixtures.noise(6.0, amplitude=0.01),
        fixtures.tone(50.0, amplitude=0.4),
    )
    segments = detect.detect_segments(audio, fixtures.SAMPLE_RATE)
    assert len(segments) == 3
    assert [s["kind"] for s in segments] == ["take", "talk", "take"]


def test_detect_segments_restart_from_top_stays_separate():
    audio = fixtures.concat(
        fixtures.tone(5.0, amplitude=0.4),
        fixtures.noise(10.0, amplitude=0.01),
        fixtures.tone(60.0, amplitude=0.4),
    )
    segments = detect.detect_segments(audio, fixtures.SAMPLE_RATE)
    assert len(segments) == 2


def test_detect_segments_continuous_noodling_merges_into_one():
    audio = fixtures.concat(
        fixtures.noise(5.0, amplitude=0.01),
        fixtures.tone(45.0, amplitude=0.4),
        fixtures.tone(3.0, amplitude=0.06),
        fixtures.tone(45.0, amplitude=0.4),
        fixtures.noise(5.0, amplitude=0.01),
    )
    segments = detect.detect_segments(audio, fixtures.SAMPLE_RATE)
    assert len(segments) == 1
    assert segments[0]["kind"] == "take"


def test_detect_segments_clipped_loud_room_still_detects():
    import numpy as np

    clipped = np.clip(fixtures.tone(60.0, amplitude=1.5), -1.0, 1.0)
    audio = fixtures.concat(
        fixtures.noise(5.0, amplitude=0.01),
        clipped,
        fixtures.noise(5.0, amplitude=0.01),
    )
    segments = detect.detect_segments(audio, fixtures.SAMPLE_RATE)
    assert len(segments) == 1
    assert segments[0]["kind"] == "take"
    assert 0.0 <= segments[0]["confidence"] <= 1.0


def test_detect_segments_every_segment_has_confidence_fields():
    audio = fixtures.concat(
        fixtures.noise(5.0, amplitude=0.01),
        fixtures.tone(50.0, amplitude=0.4),
        fixtures.noise(5.0, amplitude=0.01),
    )
    segments = detect.detect_segments(audio, fixtures.SAMPLE_RATE)
    for seg in segments:
        assert "confidence" in seg
        assert "confidence_tier" in seg
        assert 0.0 <= seg["confidence"] <= 1.0
        assert seg["confidence_tier"] in ("high", "medium", "low")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_detect.py -v`
Expected: FAIL with `AttributeError: module 'app.detect' has no attribute 'detect_segments'`.

- [ ] **Step 3: Implement `detect_segments`**

Append to `services/worker/app/detect.py`:

```python
def detect_segments(samples: np.ndarray, sample_rate: int, params: dict | None = None) -> list[dict]:
    p = {**DEFAULT_PARAMS, **(params or {})}
    weights = {**DEFAULT_PARAMS["confidence_weights"], **p.get("confidence_weights", {})}

    frame_db = frame_rms_db(samples, sample_rate, p["frame_ms"])
    smoothed = smooth_median(frame_db, p["frame_ms"], p["smooth_sec"])
    noise_floor_db, music_level_db, threshold_db = compute_threshold(smoothed, p["threshold_ratio"])
    raw_regions = find_active_regions(smoothed, threshold_db, p["frame_ms"])
    merged = merge_regions(raw_regions, p["min_gap_sec"])

    total_duration_sec = len(samples) / sample_rate
    segments = []
    for start, end, gap_used in merged:
        duration = end - start
        kind = "talk" if duration < p["min_take_sec"] else "take"

        threshold_margin = boundary_threshold_margin(
            smoothed, start, end, p["frame_ms"], threshold_db, noise_floor_db, music_level_db
        )
        gap_margin = gap_confidence_margin(gap_used, p["min_gap_sec"])
        duration_margin = duration_confidence_margin(duration, p["min_take_sec"])
        confidence = composite_confidence(threshold_margin, gap_margin, duration_margin, weights)

        padded_start = max(0.0, start - p["pad_sec"])
        padded_end = min(total_duration_sec, end + p["pad_sec"])

        segments.append(
            {
                "start_sec": round(padded_start, 3),
                "end_sec": round(padded_end, 3),
                "kind": kind,
                "confidence": round(confidence, 3),
                "confidence_tier": confidence_tier(confidence),
            }
        )

    for i in range(len(segments) - 1):
        if segments[i]["end_sec"] > segments[i + 1]["start_sec"]:
            midpoint = round((segments[i]["end_sec"] + segments[i + 1]["start_sec"]) / 2, 3)
            segments[i]["end_sec"] = midpoint
            segments[i + 1]["start_sec"] = midpoint

    return segments
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_detect.py -v`
Expected: 30 passed. If a hard-case test fails, the fixture's amplitude/duration constants need adjusting, not the detection logic — check which percentile boundary shifted before touching `detect_segments`.

- [ ] **Step 5: Commit**

```bash
git add services/worker/app/detect.py services/worker/tests/test_detect.py
git commit -m "feat(worker): wire detect_segments end-to-end with hard-case tests"
```

---

## Task 7: `audio.py` — ffmpeg wrappers and wav I/O

**Files:**
- Create: `services/worker/app/audio.py`
- Create: `services/worker/tests/test_audio.py`

Requires `ffmpeg` on PATH (Victor's Phase 0 checklist item in `HANDOFF.md` §15). If `ffmpeg -version` fails, install it before this task.

- [ ] **Step 1: Write the failing test**

```python
import subprocess
import wave
from pathlib import Path

import numpy as np

from app import audio


def test_normalize_for_analysis_produces_mono_16k_wav(tmp_path):
    src = tmp_path / "src.wav"
    with wave.open(str(src), "wb") as wf:
        wf.setnchannels(2)
        wf.setsampwidth(2)
        wf.setframerate(44100)
        samples = (np.sin(np.linspace(0, 2 * np.pi * 440, 44100)) * 10000).astype(np.int16)
        stereo = np.repeat(samples, 2)
        wf.writeframes(stereo.tobytes())

    out = tmp_path / "analysis.wav"
    audio.normalize_for_analysis(str(src), str(out))

    with wave.open(str(out), "rb") as wf:
        assert wf.getnchannels() == 1
        assert wf.getframerate() == 16000


def test_load_wav_mono_returns_float_samples_and_rate(tmp_path):
    src = tmp_path / "mono.wav"
    with wave.open(str(src), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(16000)
        samples = (np.sin(np.linspace(0, 2 * np.pi * 440, 16000)) * 10000).astype(np.int16)
        wf.writeframes(samples.tobytes())

    loaded_samples, sample_rate = audio.load_wav_mono(str(src))
    assert sample_rate == 16000
    assert len(loaded_samples) == 16000
    assert loaded_samples.dtype == np.float32
    assert np.max(np.abs(loaded_samples)) <= 1.0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_audio.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.audio'`.

- [ ] **Step 3: Implement `audio.py`**

```python
import subprocess
import wave

import numpy as np


def normalize_for_analysis(input_path: str, output_path: str) -> None:
    subprocess.run(
        ["ffmpeg", "-y", "-i", input_path, "-ac", "1", "-ar", "16000", "-f", "wav", output_path],
        check=True,
        capture_output=True,
    )


def load_wav_mono(path: str) -> tuple[np.ndarray, int]:
    with wave.open(path, "rb") as wf:
        sample_rate = wf.getframerate()
        n_frames = wf.getnframes()
        raw = wf.readframes(n_frames)
        sample_width = wf.getsampwidth()
    if sample_width != 2:
        raise ValueError(f"expected 16-bit wav, got sample width {sample_width}")
    samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    return samples, sample_rate


def cut_clip(input_path: str, output_path: str, start_sec: float, end_sec: float) -> None:
    subprocess.run(
        [
            "ffmpeg", "-y", "-i", input_path,
            "-ss", str(start_sec), "-to", str(end_sec),
            "-c", "copy", output_path,
        ],
        check=True,
        capture_output=True,
    )
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_audio.py -v`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add services/worker/app/audio.py services/worker/tests/test_audio.py
git commit -m "feat(worker): add ffmpeg wrappers and wav loading"
```

---

## Task 8: `scripts/split_local.py` CLI

**Files:**
- Create: `services/worker/scripts/split_local.py`
- Create: `services/worker/tests/test_split_local.py`

- [ ] **Step 1: Write the failing smoke test**

```python
import json
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np


def _write_wav(path: Path, duration_sec: float = 30.0, sample_rate: int = 16000) -> None:
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        t = np.linspace(0, duration_sec, int(sample_rate * duration_sec))
        samples = (np.sin(2 * np.pi * 440 * t) * 10000).astype(np.int16)
        wf.writeframes(samples.tobytes())


def test_split_local_produces_segments_and_waveform(tmp_path):
    input_wav = tmp_path / "input.wav"
    _write_wav(input_wav)
    out_dir = tmp_path / "out"

    script = Path(__file__).resolve().parent.parent / "scripts" / "split_local.py"
    result = subprocess.run(
        [sys.executable, str(script), str(input_wav), "--out", str(out_dir)],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stderr

    segments_path = out_dir / "segments.json"
    assert segments_path.exists()
    data = json.loads(segments_path.read_text())
    assert "segments" in data
    assert "params" in data
    assert (out_dir / "waveform.png").exists()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_split_local.py -v`
Expected: FAIL — script file doesn't exist, non-zero return code.

- [ ] **Step 3: Implement the CLI**

```python
#!/usr/bin/env python3
import argparse
import json
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import audio, detect


def parse_params(params_json: str | None) -> dict:
    if not params_json:
        return {}
    return json.loads(params_json)


def main() -> None:
    parser = argparse.ArgumentParser(description="Split a rehearsal recording into takes")
    parser.add_argument("input", help="Path to input audio file")
    parser.add_argument("--out", required=True, help="Output directory")
    parser.add_argument("--params", help="JSON string of param overrides")
    args = parser.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    analysis_wav = out_dir / "analysis.wav"
    audio.normalize_for_analysis(args.input, str(analysis_wav))
    samples, sample_rate = audio.load_wav_mono(str(analysis_wav))

    params = parse_params(args.params)
    segments = detect.detect_segments(samples, sample_rate, params)

    merged_params = {**detect.DEFAULT_PARAMS, **params}
    segments_path = out_dir / "segments.json"
    segments_path.write_text(json.dumps({"segments": segments, "params": merged_params}, indent=2))

    for i, seg in enumerate(segments):
        clip_path = out_dir / f"clip_{i:03d}_{seg['kind']}.wav"
        audio.cut_clip(str(analysis_wav), str(clip_path), seg["start_sec"], seg["end_sec"])

    step = max(1, len(samples) // 5000)
    duration_sec = len(samples) / sample_rate
    times = [i / sample_rate for i in range(0, len(samples), step)]
    amps = [samples[i] for i in range(0, len(samples), step)]

    fig, ax = plt.subplots(figsize=(14, 4))
    ax.plot(times, amps, linewidth=0.5, color="steelblue")
    for seg in segments:
        color = "green" if seg["kind"] == "take" else "gray"
        ax.axvspan(seg["start_sec"], seg["end_sec"], alpha=0.2, color=color)
    ax.set_xlabel("seconds")
    ax.set_xlim(0, duration_sec)
    fig.savefig(out_dir / "waveform.png", dpi=100)

    print(f"Found {len(segments)} segments. Output in {out_dir}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_split_local.py -v`
Expected: 1 passed.

- [ ] **Step 5: Run the full test suite**

Run: `pytest -v`
Expected: all tests from Tasks 3–8 pass (37 total).

- [ ] **Step 6: Commit**

```bash
git add services/worker/scripts/split_local.py services/worker/tests/test_split_local.py
git commit -m "feat(worker): add split_local CLI for Phase 0 testing"
```

---

## Task 9: Manual acceptance run (Victor)

Not automatable — this is the actual Phase 0 gate from `HANDOFF.md` §13.

- [ ] **Step 1: Run against 2–3 real KTD rehearsal recordings**

```bash
cd services/worker
python scripts/split_local.py "path/to/rehearsal.m4a" --out ./results/rehearsal1
```

- [ ] **Step 2: Compare `segments.json` against Victor's ground-truth take list**

Check `results/rehearsal1/waveform.png` alongside the ground truth log from `HANDOFF.md` §15's checklist ("write down actual takes per recording").

- [ ] **Step 3: Score against `HANDOFF.md` §3 target**

At least 90% of actual takes found, at most 1 false split per 10 takes. If it misses, note in `DECISIONS.md` which hard case is failing and adjust `DEFAULT_PARAMS` or the algorithm — do not change the acceptance target.

- [ ] **Step 4: Record the outcome**

Append to `DECISIONS.md`:
```markdown
- **<date>** — Phase 0 acceptance run on N real rehearsals: <accuracy>% takes found, <X> false splits per 10 takes. <Pass/needs tuning, and why>.
```

- [ ] **Step 5: Commit**

```bash
git add DECISIONS.md
git commit -m "docs: record Phase 0 acceptance results"
```

---

## Self-Review Notes

- **Spec coverage:** §8 steps 1–9 covered (Task 3 normalize/loudness/smoothing, Task 4 threshold/regions/merge, Task 6 classify/pad/output). Confidence spec's three margins, weighted composite, and tier mapping covered in Task 5. All 5 hard cases from §8 covered in Task 6. Waveform PNG and `--params` override covered in Task 8. Phase 0 acceptance criteria from §13 covered in Task 9.
- **Placeholder scan:** none — every step has runnable code and exact commands.
- **Type consistency:** `detect_segments` return shape (`start_sec`, `end_sec`, `kind`, `confidence`, `confidence_tier`) matches what `scripts/split_local.py` consumes in Task 8, and matches the segment shape described in `HANDOFF.md` §8/§13 and the confidence spec.
