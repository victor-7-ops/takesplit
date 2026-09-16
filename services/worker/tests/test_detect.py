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
