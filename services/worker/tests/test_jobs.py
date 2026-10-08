import io
import json
import os
import uuid
import wave

import numpy as np
import pytest
from supabase import create_client

from app import jobs

pytestmark = pytest.mark.skipif(
    "SUPABASE_URL" not in os.environ or "SUPABASE_SERVICE_ROLE_KEY" not in os.environ,
    reason="requires local Supabase stack — run `supabase start` and export SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from `supabase status -o env`",
)


def _client():
    return create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])


def _make_wav_bytes(duration_sec: float = 5.0, sample_rate: int = 16000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        t = np.linspace(0, duration_sec, int(sample_rate * duration_sec))
        samples = (np.sin(2 * np.pi * 440 * t) * 10000).astype(np.int16)
        wf.writeframes(samples.tobytes())
    return buf.getvalue()


@pytest.fixture
def band_and_user():
    client = _client()
    user_id = str(uuid.uuid4())
    client.auth.admin.create_user({"email": f"{user_id}@test.local", "id": user_id, "email_confirm": True})
    band_id = str(uuid.uuid4())
    client.table("bands").insert(
        {"id": band_id, "name": "Test Band", "invite_code": f"TEST-{band_id[:8]}", "created_by": user_id}
    ).execute()
    yield band_id, user_id
    client.table("bands").delete().eq("id", band_id).execute()
    client.auth.admin.delete_user(user_id)


def test_run_process_creates_clips_peaks_and_confidence(band_and_user):
    client = _client()
    band_id, user_id = band_and_user

    rehearsal_id = str(uuid.uuid4())
    storage_path = f"bands/{band_id}/rehearsals/{rehearsal_id}/original.wav"
    client.table("rehearsals").insert(
        {"id": rehearsal_id, "band_id": band_id, "storage_path": storage_path, "status": "uploaded", "created_by": user_id}
    ).execute()
    client.storage.from_("rehearsals").upload(storage_path, _make_wav_bytes(), {"content-type": "audio/wav"})

    jobs.run_process(rehearsal_id)

    rehearsal = client.table("rehearsals").select("*").eq("id", rehearsal_id).single().execute().data
    assert rehearsal["status"] == "ready"
    assert rehearsal["peaks_path"] is not None
    assert "clip_confidence" in rehearsal["detection_params"]

    clips = client.table("clips").select("*").eq("rehearsal_id", rehearsal_id).execute().data
    assert len(clips) >= 1
    for clip in clips:
        assert str(clip["id"]) in rehearsal["detection_params"]["clip_confidence"]
        entry = rehearsal["detection_params"]["clip_confidence"][str(clip["id"])]
        assert "score" in entry and "tier" in entry

    peaks_bytes = client.storage.from_("rehearsals").download(rehearsal["peaks_path"])
    assert len(json.loads(peaks_bytes)) > 0


def test_run_process_sets_failed_on_missing_file(band_and_user):
    client = _client()
    band_id, user_id = band_and_user

    rehearsal_id = str(uuid.uuid4())
    storage_path = f"bands/{band_id}/rehearsals/{rehearsal_id}/original.wav"
    client.table("rehearsals").insert(
        {"id": rehearsal_id, "band_id": band_id, "storage_path": storage_path, "status": "uploaded", "created_by": user_id}
    ).execute()
    # Deliberately never upload a file at storage_path.

    with pytest.raises(Exception):
        jobs.run_process(rehearsal_id)

    rehearsal = client.table("rehearsals").select("*").eq("id", rehearsal_id).single().execute().data
    assert rehearsal["status"] == "failed"
    assert rehearsal["error_message"] is not None


def test_run_process_reprocessing_keeps_manually_edited_clips(band_and_user):
    client = _client()
    band_id, user_id = band_and_user

    rehearsal_id = str(uuid.uuid4())
    storage_path = f"bands/{band_id}/rehearsals/{rehearsal_id}/original.wav"
    client.table("rehearsals").insert(
        {"id": rehearsal_id, "band_id": band_id, "storage_path": storage_path, "status": "uploaded", "created_by": user_id}
    ).execute()
    client.storage.from_("rehearsals").upload(storage_path, _make_wav_bytes(), {"content-type": "audio/wav"})

    jobs.run_process(rehearsal_id)

    manual_clip = client.table("clips").insert(
        {"rehearsal_id": rehearsal_id, "start_sec": 100, "end_sec": 110, "auto_detected": False}
    ).execute().data[0]

    jobs.run_process(rehearsal_id)

    clips_after = client.table("clips").select("*").eq("rehearsal_id", rehearsal_id).execute().data
    manual_still_present = any(c["id"] == manual_clip["id"] for c in clips_after)
    assert manual_still_present
