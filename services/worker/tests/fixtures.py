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
