import subprocess
import wave

import numpy as np


def normalize_for_analysis(input_path: str, output_path: str) -> None:
    subprocess.run(
        ["ffmpeg", "-y", "-i", input_path, "-ac", "1", "-ar", "16000", "-f", "wav", output_path],
        check=True,
        capture_output=True,
    )


def load_wav_mono(path: str) -> tuple[np.ndarray, int]:
    with wave.open(path, "rb") as wf:
        sample_rate = wf.getframerate()
        n_frames = wf.getnframes()
        raw = wf.readframes(n_frames)
        sample_width = wf.getsampwidth()
    if sample_width != 2:
        raise ValueError(f"expected 16-bit wav, got sample width {sample_width}")
    samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    return samples, sample_rate


def cut_clip(input_path: str, output_path: str, start_sec: float, end_sec: float) -> None:
    subprocess.run(
        [
            "ffmpeg", "-y", "-i", input_path,
            "-ss", str(start_sec), "-to", str(end_sec),
            "-c", "copy", output_path,
        ],
        check=True,
        capture_output=True,
    )
