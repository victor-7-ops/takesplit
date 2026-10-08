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
