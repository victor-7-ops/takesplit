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


def detect_segments(samples: np.ndarray, sample_rate: int, params: dict | None = None) -> list[dict]:
    p = {**DEFAULT_PARAMS, **(params or {})}
    weights = {**DEFAULT_PARAMS["confidence_weights"], **p.get("confidence_weights", {})}

    frame_len = int(sample_rate * p["frame_ms"] / 1000)
    if len(samples) < frame_len:
        return []

    frame_db = frame_rms_db(samples, sample_rate, p["frame_ms"])
    smoothed = smooth_median(frame_db, p["frame_ms"], p["smooth_sec"])
    noise_floor_db, music_level_db, threshold_db = compute_threshold(smoothed, p["threshold_ratio"])

    if music_level_db - noise_floor_db < 1e-6:
        # No dynamic range at all (e.g. a silent or failed recording) - every frame reads as
        # equally "active", which would otherwise produce one bogus take spanning the file.
        return []

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
