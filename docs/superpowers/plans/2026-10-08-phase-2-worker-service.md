# Phase 2 Worker Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Phase 0 detection module into a running FastAPI service that downloads a rehearsal from Supabase Storage, detects takes, uploads waveform peaks, writes clip rows with confidence scores, and updates rehearsal status — proven against the real local Supabase stack from Phase 1, not mocks.

**Architecture:** `main.py` is a thin FastAPI layer (3 endpoints, auth, background scheduling). `jobs.py` does all the Supabase I/O and orchestrates the existing pure `detect.py`/`audio.py` plus the new `peaks.py`. `peaks.py` stays pure (array in, array out) like `detect.py` — no reason to break that pattern for one more pure function.

**Tech Stack:** FastAPI, uvicorn, `supabase-py` (official client), the existing `detect.py`/`audio.py` from Phase 0. No task queue, no retry framework — `BackgroundTasks` is what HANDOFF.md's MVP framing calls for, and a queue is unneeded complexity for one background job per upload.

---

## File Structure

```
services/worker/
├── app/
│   ├── main.py       # FastAPI: GET /health, POST /process, POST /detect-preview
│   ├── peaks.py       # pure: samples -> [[min,max], ...] waveform peaks
│   ├── jobs.py        # Supabase I/O: download, detect, upload peaks, write clips/status
│   ├── detect.py       # (existing, unchanged)
│   └── audio.py       # (existing, unchanged)
├── tests/
│   ├── test_peaks.py
│   ├── test_main.py
│   └── test_jobs.py    # real integration test against local Supabase
├── Dockerfile
├── .env.example
└── pyproject.toml     # modified: add fastapi, uvicorn, supabase
```

`jobs.py` is the only new file that talks to Supabase — `main.py` never touches the database directly, `peaks.py` never touches the network. Same separation of concerns Phase 0 established between `detect.py` (pure) and `audio.py` (I/O).

---

## Task 1: Add worker service dependencies

**Files:**
- Modify: `services/worker/pyproject.toml`

- [ ] **Step 1: Add the new dependencies**

Current `pyproject.toml` has `numpy`, `matplotlib` as dependencies and `pytest` as dev. Add `fastapi`, `uvicorn[standard]`, `supabase`, and `httpx` (FastAPI's `TestClient` needs `httpx` installed):

```toml
[project]
name = "takesplit-worker"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "numpy>=1.26",
    "matplotlib>=3.8",
    "fastapi>=0.115",
    "uvicorn[standard]>=0.32",
    "supabase>=2.9",
]

[project.optional-dependencies]
dev = ["pytest>=8.0", "httpx>=0.27"]

[tool.pytest.ini_options]
pythonpath = ["."]
```

- [ ] **Step 2: Install and verify**

```bash
cd services/worker
pip install -e ".[dev]"
python -c "import fastapi, uvicorn, supabase; print('ok')"
```

Expected: `ok` printed, no import errors.

- [ ] **Step 3: Commit**

```bash
git add services/worker/pyproject.toml
git commit -m "chore(worker): add fastapi/uvicorn/supabase dependencies"
```

---

## Task 2: `peaks.py` — waveform peak extraction

**Files:**
- Create: `services/worker/app/peaks.py`
- Test: `services/worker/tests/test_peaks.py`

`HANDOFF.md` §8: "Generate ~2,000 min/max pairs for the whole file ... The app renders from this; it never decodes the full audio for drawing." This is pure — same rule as `detect.py`.

- [ ] **Step 1: Write the failing tests**

```python
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
```

- [ ] **Step 2: Run to verify failure**

Run: `cd services/worker && pytest tests/test_peaks.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.peaks'`.

- [ ] **Step 3: Implement**

```python
import numpy as np


def compute_peaks(samples: np.ndarray, num_points: int = 2000) -> list[list[float]]:
    if len(samples) == 0:
        return []
    chunk_size = max(1, len(samples) // num_points)
    pairs = []
    for i in range(0, len(samples), chunk_size):
        chunk = samples[i : i + chunk_size]
        pairs.append([round(float(chunk.min()), 4), round(float(chunk.max()), 4)])
    return pairs
```

- [ ] **Step 4: Run to verify pass**

Run: `pytest tests/test_peaks.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add services/worker/app/peaks.py services/worker/tests/test_peaks.py
git commit -m "feat(worker): add waveform peaks extraction"
```

---

## Task 3: `main.py` — FastAPI endpoints

**Files:**
- Create: `services/worker/app/main.py`
- Test: `services/worker/tests/test_main.py`

`HANDOFF.md` §9: 3 endpoints, `X-Worker-Key` header auth on all of them, `/process` returns 202 immediately and runs in background. `jobs.py` doesn't exist yet (Task 4) — these tests mock it out, since `main.py`'s job is routing/auth, not job execution.

- [ ] **Step 1: Write the failing tests**

```python
import os

os.environ.setdefault("WORKER_KEY", "test-worker-key")

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_returns_ok():
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_process_without_key_header_is_rejected():
    resp = client.post("/process", json={"rehearsal_id": "x"})
    assert resp.status_code == 422


def test_process_with_wrong_key_is_unauthorized():
    resp = client.post(
        "/process", json={"rehearsal_id": "x"}, headers={"X-Worker-Key": "wrong"}
    )
    assert resp.status_code == 401


def test_process_with_correct_key_returns_202_and_schedules_job(monkeypatch):
    scheduled = []
    monkeypatch.setattr("app.main.jobs.run_process", lambda rehearsal_id: scheduled.append(rehearsal_id))

    resp = client.post(
        "/process",
        json={"rehearsal_id": "abc-123"},
        headers={"X-Worker-Key": "test-worker-key"},
    )

    assert resp.status_code == 202
    assert scheduled == ["abc-123"]


def test_detect_preview_with_correct_key_returns_segments(monkeypatch):
    monkeypatch.setattr(
        "app.main.jobs.run_detect_preview",
        lambda rehearsal_id, params: [{"start_sec": 0, "end_sec": 10, "kind": "take", "confidence": 0.9, "confidence_tier": "high"}],
    )

    resp = client.post(
        "/detect-preview",
        json={"rehearsal_id": "abc-123", "params": {"threshold_ratio": 0.4}},
        headers={"X-Worker-Key": "test-worker-key"},
    )

    assert resp.status_code == 200
    assert resp.json() == {
        "segments": [{"start_sec": 0, "end_sec": 10, "kind": "take", "confidence": 0.9, "confidence_tier": "high"}]
    }
```

- [ ] **Step 2: Run to verify failure**

Run: `pytest tests/test_main.py -v`
Expected: FAIL — `app.main` doesn't exist.

- [ ] **Step 3: Implement**

`jobs.py` doesn't exist yet, so this imports it before it's built — that's fine, Python only needs the module to exist when `main.py` is actually imported, which happens in Task 3's own test run after Task 4 would normally land. Since Task 4 comes after this one in the plan, create a minimal `jobs.py` stub right now so `main.py` can import it; Task 4 replaces the stub with the real implementation.

Create `services/worker/app/jobs.py` (temporary stub, replaced in Task 4):

```python
def run_process(rehearsal_id: str) -> None:
    raise NotImplementedError


def run_detect_preview(rehearsal_id: str, params: dict) -> list[dict]:
    raise NotImplementedError
```

Create `services/worker/app/main.py`:

```python
import os

from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel

from app import jobs

app = FastAPI()


def require_worker_key(x_worker_key: str = Header(...)) -> None:
    if x_worker_key != os.environ["WORKER_KEY"]:
        raise HTTPException(status_code=401, detail="invalid worker key")


class ProcessRequest(BaseModel):
    rehearsal_id: str


class DetectPreviewRequest(BaseModel):
    rehearsal_id: str
    params: dict = {}


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/process", status_code=202, dependencies=[Depends(require_worker_key)])
def process(body: ProcessRequest, background_tasks: BackgroundTasks) -> dict:
    background_tasks.add_task(jobs.run_process, body.rehearsal_id)
    return {"status": "processing"}


@app.post("/detect-preview", dependencies=[Depends(require_worker_key)])
def detect_preview(body: DetectPreviewRequest) -> dict:
    segments = jobs.run_detect_preview(body.rehearsal_id, body.params)
    return {"segments": segments}
```

- [ ] **Step 4: Run to verify pass**

Run: `pytest tests/test_main.py -v`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add services/worker/app/main.py services/worker/app/jobs.py services/worker/tests/test_main.py
git commit -m "feat(worker): add FastAPI endpoints with worker-key auth"
```

---

## Task 4: `jobs.py` — real implementation and integration test

**Files:**
- Modify: `services/worker/app/jobs.py` (replacing Task 3's stub)
- Test: `services/worker/tests/test_jobs.py`

This is the real orchestration: download → normalize → detect → peaks → upload → write clips → patch confidence → update status. Tested against the **actual local Supabase stack** already running from Phase 1 (service-role key bypasses RLS entirely, so no auth simulation needed here — unlike the Phase 1 pgTAP tests). `HANDOFF.md` §9's rules this must satisfy: set `status='processing'` at start, `status='failed'`+`error_message` on any exception, idempotent reprocessing (deletes `auto_detected=true` clips, keeps manually-edited ones), and the confidence spec's `clip_confidence` map keyed by real clip UUIDs.

- [ ] **Step 1: Get local Supabase credentials**

```bash
supabase status -o env
```

This prints `SUPABASE_URL` (actually labeled `API_URL`) and `SUPABASE_SERVICE_ROLE_KEY` (labeled `SERVICE_ROLE_KEY`) for the locally running stack. Export them for this terminal session (rename to match what `jobs.py` reads):

```bash
export SUPABASE_URL=$(supabase status -o env | grep API_URL | cut -d'"' -f2)
export SUPABASE_SERVICE_ROLE_KEY=$(supabase status -o env | grep SERVICE_ROLE_KEY | cut -d'"' -f2)
echo "$SUPABASE_URL"
```

Expected: prints something like `http://127.0.0.1:54321`. If `supabase status` errors with "not running", run `supabase start` first (Phase 1 already proved this works on this machine).

- [ ] **Step 2: Write the failing integration tests**

```python
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
```

- [ ] **Step 3: Run to verify failure**

Run: `pytest tests/test_jobs.py -v`
Expected: FAIL — `jobs.run_process` raises `NotImplementedError` (Task 3's stub).

- [ ] **Step 4: Replace the stub with the real implementation**

Overwrite `services/worker/app/jobs.py`:

```python
import json
import os
import tempfile
from pathlib import Path

from supabase import create_client

from app import audio, detect, peaks

BUCKET = "rehearsals"


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
            samples, sample_rate = _download_and_load(client, storage_path, tmp_dir)

            segments = detect.detect_segments(samples, sample_rate, params)
            peak_pairs = peaks.compute_peaks(samples)

            peaks_path = f"{str(Path(storage_path).parent)}/peaks.json".replace("\\", "/")
            client.storage.from_(BUCKET).upload(
                peaks_path,
                json.dumps(peak_pairs).encode(),
                {"content-type": "application/json", "upsert": "true"},
            )

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
        client.table("rehearsals").update(
            {"status": "failed", "error_message": str(e)}
        ).eq("id", rehearsal_id).execute()
        raise


def run_detect_preview(rehearsal_id: str, params: dict) -> list[dict]:
    client = _client()
    rehearsal = client.table("rehearsals").select("storage_path").eq("id", rehearsal_id).single().execute().data

    with tempfile.TemporaryDirectory() as tmp_dir:
        samples, sample_rate = _download_and_load(client, rehearsal["storage_path"], tmp_dir)

    return detect.detect_segments(samples, sample_rate, params)
```

Note on `peaks_path`: `Path(storage_path).parent` on Windows can render backslashes; the `.replace("\\", "/")` keeps the stored path forward-slash, matching the `bands/{band_id}/rehearsals/{rehearsal_id}/...` convention from `HANDOFF.md` §7 regardless of the host OS running the worker.

- [ ] **Step 5: Run to verify pass**

```bash
export SUPABASE_URL=$(supabase status -o env | grep API_URL | cut -d'"' -f2)
export SUPABASE_SERVICE_ROLE_KEY=$(supabase status -o env | grep SERVICE_ROLE_KEY | cut -d'"' -f2)
cd services/worker
pytest tests/test_jobs.py -v
```

Expected: 3 passed. If `test_run_process_creates_clips_peaks_and_confidence` fails with zero clips, the 5-second synthetic tone in `_make_wav_bytes` may be too short to pass `detect.py`'s `min_take_sec` default (40.0) and gets classified `talk` rather than `take` — that's fine, the test only asserts `len(clips) >= 1`, not `kind == "take"`, so this shouldn't actually break it. If it does, lengthen `duration_sec` in `_make_wav_bytes`.

- [ ] **Step 6: Commit**

```bash
git add services/worker/app/jobs.py services/worker/tests/test_jobs.py
git commit -m "feat(worker): implement jobs.run_process with Supabase I/O and confidence scoring"
```

---

## Task 5: Dockerfile and `.env.example`

**Files:**
- Create: `services/worker/Dockerfile`
- Create: `services/worker/.env.example`

- [ ] **Step 1: Write the Dockerfile**

```dockerfile
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY pyproject.toml .
COPY app ./app
RUN pip install --no-cache-dir .

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Step 2: Write `.env.example`**

```
WORKER_KEY=change-me
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=change-me
```

Per `CLAUDE.md`: never commit the real service role key or worker key — this file documents the shape, not real values.

- [ ] **Step 3: Verify the image builds**

```bash
cd services/worker
docker build -t takesplit-worker .
```

Expected: build succeeds (this also validates the `pyproject.toml` dependency list is complete and `ffmpeg` installs cleanly in the container).

- [ ] **Step 4: Commit**

```bash
git add services/worker/Dockerfile services/worker/.env.example
git commit -m "feat(worker): add Dockerfile and env example"
```

---

## Task 6: End-to-end API acceptance check

**Files:** none created — this exercises the running service exactly as `HANDOFF.md` §13 Phase 2's acceptance criterion describes: "uploading a file manually to Storage and calling `/process` produces clip rows and peaks JSON, and a failure sets `status='failed'`." Tasks 1-5 already proved `jobs.py` works at the function level; this proves the HTTP layer (auth header, 202 response, background execution) on top of it.

- [ ] **Step 1: Start the worker locally**

```bash
cd services/worker
export WORKER_KEY=test-worker-key
export SUPABASE_URL=$(supabase status -o env | grep API_URL | cut -d'"' -f2)
export SUPABASE_SERVICE_ROLE_KEY=$(supabase status -o env | grep SERVICE_ROLE_KEY | cut -d'"' -f2)
uvicorn app.main:app --port 8000 &
```

- [ ] **Step 2: Confirm health**

```bash
curl -s http://127.0.0.1:8000/health
```

Expected: `{"status":"ok"}`

- [ ] **Step 3: Manually upload a rehearsal via the Supabase client and call `/process`**

```bash
python3 -c "
import os, uuid, numpy as np, io, wave
from supabase import create_client

client = create_client(os.environ['SUPABASE_URL'], os.environ['SUPABASE_SERVICE_ROLE_KEY'])

user_id = str(uuid.uuid4())
client.auth.admin.create_user({'email': f'{user_id}@test.local', 'id': user_id, 'email_confirm': True})
band_id = str(uuid.uuid4())
client.table('bands').insert({'id': band_id, 'name': 'Acceptance Band', 'invite_code': f'ACC-{band_id[:8]}', 'created_by': user_id}).execute()
rehearsal_id = str(uuid.uuid4())
storage_path = f'bands/{band_id}/rehearsals/{rehearsal_id}/original.wav'
client.table('rehearsals').insert({'id': rehearsal_id, 'band_id': band_id, 'storage_path': storage_path, 'status': 'uploaded', 'created_by': user_id}).execute()

buf = io.BytesIO()
with wave.open(buf, 'wb') as wf:
    wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(16000)
    t = np.linspace(0, 5.0, 80000)
    wf.writeframes((np.sin(2*np.pi*440*t)*10000).astype(np.int16).tobytes())
client.storage.from_('rehearsals').upload(storage_path, buf.getvalue(), {'content-type': 'audio/wav'})

print(rehearsal_id)
"
```

Copy the printed `rehearsal_id`, then:

```bash
curl -s -X POST http://127.0.0.1:8000/process \
  -H "X-Worker-Key: test-worker-key" \
  -H "Content-Type: application/json" \
  -d '{"rehearsal_id": "<paste-rehearsal-id-here>"}'
```

Expected: HTTP 202, body `{"status":"processing"}`.

- [ ] **Step 4: Verify the background job completed**

Wait a few seconds, then check via the Supabase client (or `supabase studio` at the local Studio URL from `supabase status`) that the rehearsal's `status` became `ready`, `peaks_path` is set, and a `clips` row exists for that `rehearsal_id`.

- [ ] **Step 5: Stop the server**

```bash
kill %1
```

- [ ] **Step 6: Record the result in `DECISIONS.md`**

```markdown
- **<date>** — Phase 2 end-to-end acceptance check: started worker via `uvicorn`, uploaded a real file via the Supabase client, called `POST /process` with the worker key, confirmed 202 response and that the background job produced clip rows + `peaks.json` + `status='ready'`. Matches `HANDOFF.md` §13's Phase 2 acceptance criterion.
```

- [ ] **Step 7: Commit**

```bash
git add DECISIONS.md
git commit -m "docs: record Phase 2 end-to-end acceptance check"
```

---

## Self-Review Notes

- **Spec coverage:** `HANDOFF.md` §9's 3 endpoints + worker-key auth + 202-background behavior (Task 3), idempotent reprocessing and `status='failed'`+`error_message` on exception (Task 4), §8's waveform peaks requirement (Task 2, previously missing from Phase 0 despite being in the original repo structure), the confidence spec's `clip_confidence` map keyed by real clip UUIDs (Task 4), §12's Dockerfile (Task 5), §13's Phase 2 acceptance criterion tested both at the function level (Task 4, real Supabase integration test) and the HTTP level (Task 6, real curl against a running server) — stronger than the spec strictly requires, but cheap given the local stack is already up from Phase 1.
- **Placeholder scan:** Task 3 deliberately creates a stub `jobs.py` so `main.py` has something importable before Task 4 — this is flagged explicitly as temporary and fully replaced in Task 4, not a silently-abandoned TODO.
- **Type consistency:** `jobs.run_process(rehearsal_id: str)` and `jobs.run_detect_preview(rehearsal_id: str, params: dict)` signatures match exactly between Task 3's stub, `main.py`'s calls, and Task 4's real implementation and tests. `detect.detect_segments`'s return shape (`start_sec`, `end_sec`, `kind`, `confidence`, `confidence_tier`) — already proven in Phase 0 — is what `jobs.py` reads directly with no field renaming.
- **Known gap, not fixed here:** `jobs.py`'s exception handler updates `error_message` with `str(e)`, which could leak internal paths/stack details to anyone who can read `rehearsals.error_message` (any band member, per Phase 1's RLS). Low risk for MVP (your own band's own errors), but worth a truncation/sanitization pass before Phase 5 opens this up to other bands' users on a shared deployment.

