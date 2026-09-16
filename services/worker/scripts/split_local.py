#!/usr/bin/env python3
import argparse
import json
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import audio, detect


def parse_params(params_json: str | None) -> dict:
    if not params_json:
        return {}
    return json.loads(params_json)


def main() -> None:
    parser = argparse.ArgumentParser(description="Split a rehearsal recording into takes")
    parser.add_argument("input", help="Path to input audio file")
    parser.add_argument("--out", required=True, help="Output directory")
    parser.add_argument("--params", help="JSON string of param overrides")
    args = parser.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    analysis_wav = out_dir / "analysis.wav"
    audio.normalize_for_analysis(args.input, str(analysis_wav))
    samples, sample_rate = audio.load_wav_mono(str(analysis_wav))

    params = parse_params(args.params)
    segments = detect.detect_segments(samples, sample_rate, params)

    merged_params = {**detect.DEFAULT_PARAMS, **params}
    segments_path = out_dir / "segments.json"
    segments_path.write_text(json.dumps({"segments": segments, "params": merged_params}, indent=2))

    for i, seg in enumerate(segments):
        clip_path = out_dir / f"clip_{i:03d}_{seg['kind']}.wav"
        audio.cut_clip(str(analysis_wav), str(clip_path), seg["start_sec"], seg["end_sec"])

    step = max(1, len(samples) // 5000)
    duration_sec = len(samples) / sample_rate
    times = [i / sample_rate for i in range(0, len(samples), step)]
    amps = [samples[i] for i in range(0, len(samples), step)]

    fig, ax = plt.subplots(figsize=(14, 4))
    ax.plot(times, amps, linewidth=0.5, color="steelblue")
    for seg in segments:
        color = "green" if seg["kind"] == "take" else "gray"
        ax.axvspan(seg["start_sec"], seg["end_sec"], alpha=0.2, color=color)
    ax.set_xlabel("seconds")
    ax.set_xlim(0, duration_sec)
    fig.savefig(out_dir / "waveform.png", dpi=100)

    print(f"Found {len(segments)} segments. Output in {out_dir}")


if __name__ == "__main__":
    main()
