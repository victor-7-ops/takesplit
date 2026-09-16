import subprocess
import wave
from pathlib import Path

import numpy as np

from app import audio


def test_normalize_for_analysis_produces_mono_16k_wav(tmp_path):
    src = tmp_path / "src.wav"
    with wave.open(str(src), "wb") as wf:
        wf.setnchannels(2)
        wf.setsampwidth(2)
        wf.setframerate(44100)
        samples = (np.sin(np.linspace(0, 2 * np.pi * 440, 44100)) * 10000).astype(np.int16)
        stereo = np.repeat(samples, 2)
        wf.writeframes(stereo.tobytes())

    out = tmp_path / "analysis.wav"
    audio.normalize_for_analysis(str(src), str(out))

    with wave.open(str(out), "rb") as wf:
        assert wf.getnchannels() == 1
        assert wf.getframerate() == 16000


def test_load_wav_mono_returns_float_samples_and_rate(tmp_path):
    src = tmp_path / "mono.wav"
    with wave.open(str(src), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(16000)
        samples = (np.sin(np.linspace(0, 2 * np.pi * 440, 16000)) * 10000).astype(np.int16)
        wf.writeframes(samples.tobytes())

    loaded_samples, sample_rate = audio.load_wav_mono(str(src))
    assert sample_rate == 16000
    assert len(loaded_samples) == 16000
    assert loaded_samples.dtype == np.float32
    assert np.max(np.abs(loaded_samples)) <= 1.0
