import json
import subprocess
import sys
import wave
from pathlib import Path

import numpy as np


def _write_wav(path: Path, duration_sec: float = 30.0, sample_rate: int = 16000) -> None:
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        t = np.linspace(0, duration_sec, int(sample_rate * duration_sec))
        samples = (np.sin(2 * np.pi * 440 * t) * 10000).astype(np.int16)
        wf.writeframes(samples.tobytes())


def test_split_local_produces_segments_and_waveform(tmp_path):
    input_wav = tmp_path / "input.wav"
    _write_wav(input_wav)
    out_dir = tmp_path / "out"

    script = Path(__file__).resolve().parent.parent / "scripts" / "split_local.py"
    result = subprocess.run(
        [sys.executable, str(script), str(input_wav), "--out", str(out_dir)],
        capture_output=True, text=True,
    )
    assert result.returncode == 0, result.stderr

    segments_path = out_dir / "segments.json"
    assert segments_path.exists()
    data = json.loads(segments_path.read_text())
    assert "segments" in data
    assert "params" in data
    assert (out_dir / "waveform.png").exists()
