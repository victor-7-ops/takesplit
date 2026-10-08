import json
import logging
import os
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path

from supabase import create_client

from app import audio, detect, peaks

BUCKET = "rehearsals"
logger = logging.getLogger("takesplit.jobs")


@contextmanager
def _timed(step: str):
    start = time.time()
    try:
        yield
    finally:
        logger.info("%s took %.2fs", step, time.time() - start)


def _client():
    return create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])


def _download_and_load(client, storage_path: str, tmp_dir: str) -> tuple:
    original_path = Path(tmp_dir) / ("original" + Path(storage_path).suffix)
    original_bytes = client.storage.from_(BUCKET).download(storage_path)
    original_path.write_bytes(original_bytes)

    analysis_path = Path(tmp_dir) / "analysis.wav"
    audio.normalize_for_analysis(str(original_path), str(analysis_path))
    return audio.load_wav_mono(str(analysis_path))


def run_process(rehearsal_id: str) -> None:
    client = _client()
    client.table("rehearsals").update({"status": "processing"}).eq("id", rehearsal_id).execute()

    try:
        rehearsal = client.table("rehearsals").select("*").eq("id", rehearsal_id).single().execute().data
        storage_path = rehearsal["storage_path"]
        params = rehearsal.get("detection_params") or {}

        with tempfile.TemporaryDirectory() as tmp_dir:
            with _timed("download+normalize"):
                samples, sample_rate = _download_and_load(client, storage_path, tmp_dir)

            with _timed("detect"):
                segments = detect.detect_segments(samples, sample_rate, params)

            with _timed("peaks"):
                peak_pairs = peaks.compute_peaks(samples)

            peaks_path = f"{str(Path(storage_path).parent)}/peaks.json".replace("\\", "/")
            with _timed("upload peaks"):
                client.storage.from_(BUCKET).upload(
                    peaks_path,
                    json.dumps(peak_pairs).encode(),
                    {"content-type": "application/json", "upsert": "true"},
                )

        with _timed("write clips"):
            client.table("clips").delete().eq("rehearsal_id", rehearsal_id).eq("auto_detected", True).execute()

            clip_confidence = {}
            for seg in segments:
                inserted = (
                    client.table("clips")
                    .insert(
                        {
                            "rehearsal_id": rehearsal_id,
                            "start_sec": seg["start_sec"],
                            "end_sec": seg["end_sec"],
                            "kind": seg["kind"],
                            "auto_detected": True,
                        }
                    )
                    .execute()
                    .data[0]
                )
                clip_confidence[str(inserted["id"])] = {"score": seg["confidence"], "tier": seg["confidence_tier"]}

        merged_params = {**detect.DEFAULT_PARAMS, **params, "clip_confidence": clip_confidence}
        client.table("rehearsals").update(
            {
                "status": "ready",
                "peaks_path": peaks_path,
                "duration_sec": len(samples) / sample_rate,
                "detection_params": merged_params,
            }
        ).eq("id", rehearsal_id).execute()

    except Exception as e:
        try:
            client.table("rehearsals").update(
                {"status": "failed", "error_message": str(e)}
            ).eq("id", rehearsal_id).execute()
        except Exception:
            logger.exception("failed to record failure status for rehearsal %s", rehearsal_id)
        raise


def run_detect_preview(rehearsal_id: str, params: dict) -> list[dict]:
    client = _client()
    rehearsal = client.table("rehearsals").select("storage_path").eq("id", rehearsal_id).single().execute().data

    with tempfile.TemporaryDirectory() as tmp_dir:
        samples, sample_rate = _download_and_load(client, rehearsal["storage_path"], tmp_dir)

    return detect.detect_segments(samples, sample_rate, params)
