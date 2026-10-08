import numpy as np

from app import peaks


def test_compute_peaks_empty_input_returns_empty_list():
    assert peaks.compute_peaks(np.array([])) == []


def test_compute_peaks_single_chunk_captures_min_and_max():
    samples = np.array([0.0, 1.0, -1.0, 0.5, -0.5])
    pairs = peaks.compute_peaks(samples, num_points=1)
    assert len(pairs) == 1
    assert pairs[0] == [-1.0, 1.0]


def test_compute_peaks_returns_roughly_num_points_pairs():
    samples = np.linspace(-1, 1, 20000)
    pairs = peaks.compute_peaks(samples, num_points=10)
    assert 1 <= len(pairs) <= 11


def test_compute_peaks_every_pair_has_min_le_max():
    samples = np.sin(np.linspace(0, 100, 50000))
    pairs = peaks.compute_peaks(samples, num_points=2000)
    for lo, hi in pairs:
        assert lo <= hi
