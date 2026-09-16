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
