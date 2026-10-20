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
        fixtures.tone(8.0, amplitude=0.25),
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


def test_detect_segments_pure_silence_produces_no_segments():
    silence = np.zeros(fixtures.SAMPLE_RATE * 60)
    segments = detect.detect_segments(silence, fixtures.SAMPLE_RATE)
    assert segments == []


def test_detect_segments_audio_shorter_than_one_frame_produces_no_segments():
    tiny = np.zeros(50)
    segments = detect.detect_segments(tiny, fixtures.SAMPLE_RATE)
    assert segments == []


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
