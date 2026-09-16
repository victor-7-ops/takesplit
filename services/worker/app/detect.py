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
