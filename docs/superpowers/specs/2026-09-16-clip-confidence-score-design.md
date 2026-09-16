# Clip Confidence Score — Design

Date: 2026-09-16
Status: Draft, pending user review
Parent doc: `HANDOFF.md` (TakeSplit)

## Problem

The splitting algorithm (§8 of HANDOFF.md) has known hard cases: quiet talk near the loudness threshold, gaps close to `min_gap_sec`, takes close to `min_take_sec`. It will usually get these right but not always. Today the only signal a band member has that a clip might be wrong is scrubbing the whole waveform themselves — same problem the product exists to solve, just at a smaller scale.

This feature adds a per-clip confidence score, computed at detection time, surfaced as a 3-tier badge (`high`/`medium`/`low`) so a band member can jump straight to the handful of clips worth double-checking instead of re-verifying everything.

## Scope

In scope: confidence scoring in `detect.py`, storage in `rehearsals.detection_params`, wiring in `jobs.py`, and three UI surfaces (clip row badge, waveform tint, rehearsal-level review banner).

Out of scope: per-band or cross-rehearsal confidence analytics, ML-based confidence (this is a deterministic formula off the same signals `detect.py` already computes), confidence for manually-created clips (score only exists for `auto_detected` origin; see Data Model).

This slots into Phase 0 (`detect.py` logic + tests) and Phase 4 (UI surfaces) of HANDOFF.md's build phases — not a new phase.

## 1. Scoring algorithm (`detect.py`)

For each detected segment, compute three sub-scores, each normalized to `[0, 1]` where `1` = confident:

- **`threshold_margin`** — distance of the segment's boundary-frame dB from `threshold_db`, normalized by `(music_level_db - noise_floor_db)`. A boundary sitting right at the threshold scores near `0`; a boundary deep into clearly-loud or clearly-quiet territory scores near `1`.
- **`gap_margin`** — for segments formed by merging across a gap, `min(1, gap_used_sec / min_gap_sec)`. A gap just under the merge cutoff scores low (could plausibly have been a real split).
- **`duration_margin`** — `min(1, take_len_sec / min_take_sec)`. A take just over the minimum length scores low (ambiguous talk-vs-take classification).

Composite score:

```
confidence = 0.4 * threshold_margin + 0.3 * gap_margin + 0.3 * duration_margin
```

Weights live alongside the existing detection defaults (`frame_ms`, `threshold_ratio`, etc. — see §8 of HANDOFF.md) and are tunable during the same Phase 0 calibration pass.

Tier mapping: `high` ≥ 0.7, `medium` 0.4–0.7, `low` < 0.4.

`detect.py` remains pure: same signature, segments now carry an added `confidence: float` field alongside `start_sec`, `end_sec`, `kind`. No I/O added.

## 2. Data model

No schema migration. `rehearsals.detection_params` (existing jsonb column) gains two keys, written once per successful process/reprocess run:

```json
{
  "frame_ms": 100, "smooth_sec": 1.0, "threshold_ratio": 0.35,
  "min_gap_sec": 4.0, "min_take_sec": 40.0, "pad_sec": 1.0,
  "confidence_weights": {"threshold": 0.4, "gap": 0.3, "duration": 0.3},
  "clip_confidence": {
    "<clip_uuid>": {"score": 0.62, "tier": "medium"}
  }
}
```

`clip_confidence` is keyed by clip UUID (known only after insert, so written in a follow-up step — see §3).

**Reprocessing:** `jobs.py` already deletes all `auto_detected=true` clips and re-inserts on reprocess (idempotency rule, HANDOFF.md §9), keeping manually-edited (`auto_detected=false`) clips untouched. The full `clip_confidence` map is replaced on every reprocess. Entries for clips that were manually edited before a reprocess remain in the map with their original score (stale, but harmless — they're display-only) until that clip itself is deleted/reprocessed.

**Manually-created clips** (split/merge by a user, not from detection) have no entry in `clip_confidence` — treated as no badge / `high` tier by absence, since a human already made that call.

**Known tradeoff:** filtering "all low-confidence clips" is a jsonb scan on `rehearsals`, not a clip-level SQL `WHERE`. Fine at MVP scale (per-rehearsal lookup on page load, not a cross-band query). If this needs to scale later (e.g. a cross-band "review queue" view), revisit as a `clips.confidence_tier` column.

## 3. Worker wiring (`jobs.py`)

Existing flow: download → detect → insert clips → done.

1. `detect.py` returns segments, each with `confidence` alongside `start_sec/end_sec/kind`.
2. Clip rows insert as today — `confidence` is not a clip column, so the insert statement is unchanged.
3. After insert, `jobs.py` has `(clip_id, segment_index)` pairs from the DB response. It builds `{clip_id: {score, tier}}` from the matching segment's `confidence`, then does one `UPDATE rehearsals SET detection_params = detection_params || :clip_confidence_patch WHERE id = :rehearsal_id`.
4. `/detect-preview` (HANDOFF.md §9, no-save endpoint): confidence is returned inline in the preview response per segment. No DB write — consistent with that endpoint's existing "don't persist" contract.

Failure handling is unchanged: an exception at this step is caught by the existing generic handler, setting `status='failed'` and `error_message`.

## 4. App consumption + UI surfacing

The app already fetches `detection_params` when loading a rehearsal (HANDOFF.md §7). It reads `detection_params.clip_confidence[clip.id]` client-side — no new query.

No special-casing between `auto_detected=true` and `auto_detected=false` clips: any clip with a `clip_confidence` entry displays its tier consistently across all three surfaces until the next reprocess clears/replaces it.

Three surfaces, all driven off the same tier value:

- **Clip row badge:** small colored dot next to the time range in the clip list. No badge / gray = high or absent, amber = medium, red = low.
- **Waveform tint:** the clip's region gets an amber or red border/fill variant instead of the default take/talk coloring when tier is medium/low. Reuses the existing region-coloring mechanism (HANDOFF.md §10's waveform view).
- **Rehearsal-level banner:** header on rehearsal detail reads `"N clips need review"`, where N = count of clips with tier `medium` or `low`. Tapping scrolls to the first flagged clip. Hidden entirely when N = 0.

## 5. Testing

- **`test_detect.py`** (extends existing Phase 0 hard-case fixtures, HANDOFF.md §8):
  - Existing hard-case fixtures gain assertions on `confidence`: e.g. the "quiet intro inside a song" fixture must not split, but if detection logic changes and it does, the new boundary must score `low` — a canary that prevents false confidence on a known-tricky case.
  - New fixture: boundary exactly at `threshold_db` → expect `low` tier.
  - New fixture: boundary far from all three margins → expect `high` tier.
- **Worker-side test** (`jobs.py` / DB integration test): `clip_confidence` map keys match inserted clip UUIDs after processing; reprocessing replaces the map fully for `auto_detected=true` clips.
- **App-side:** pure helper (score → tier, tier → badge color) gets a unit test, per the existing convention (HANDOFF.md §14: test pure helpers like take numbering, time formatting).

## Open questions / risks carried forward

- Weight values (`0.4/0.3/0.3`) are a starting guess — tune during Phase 0's real-rehearsal calibration pass alongside `threshold_ratio`, `min_gap_sec`, etc.
- If low-confidence clips turn out to correlate poorly with actual mistakes (measured during Phase 0 acceptance testing), the formula needs revisiting before Phase 4 UI work locks it in.
