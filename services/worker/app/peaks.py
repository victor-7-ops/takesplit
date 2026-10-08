import numpy as np


def compute_peaks(samples: np.ndarray, num_points: int = 2000) -> list[list[float]]:
    if len(samples) == 0:
        return []
    chunk_size = max(1, len(samples) // num_points)
    pairs = []
    for i in range(0, len(samples), chunk_size):
        chunk = samples[i : i + chunk_size]
        pairs.append([round(float(chunk.min()), 4), round(float(chunk.max()), 4)])
    return pairs
