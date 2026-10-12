import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app

SAMPLE = Path(__file__).resolve().parents[2] / "web" / "public" / "samples" / "primer-groove-drums.wav"
client = TestClient(app)


def test_health():
    r = client.get("/health")
    assert r.status_code == 200 and r.json()["ok"]


@pytest.mark.skipif(not SAMPLE.exists(), reason="Ejecuta `npm run gen:samples` en web/ primero")
def test_job_roundtrip():
    with SAMPLE.open("rb") as f:
        r = client.post("/transcribe", files={"file": ("x.wav", f, "audio/wav")}, data={"separate": "false"})
    assert r.status_code == 200
    job = r.json()["job_id"]
    for _ in range(120):
        j = client.get(f"/jobs/{job}").json()
        if j["status"] in ("done", "error"):
            break
        time.sleep(0.5)
    assert j["status"] == "done", j
    assert len(j["result"]["events"]) > 100
