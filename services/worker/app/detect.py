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
