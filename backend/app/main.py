"""
Servicio de transcripción de DrumStudio (FastAPI).

  GET  /health                     estado y capacidades
  POST /transcribe                 (multipart: file, separate) -> {job_id}
  GET  /jobs/{id}                  progreso y resultado
  GET  /jobs/{id}/stems/{name}.wav stems separados (drums / backing)

Los trabajos se ejecutan de uno en uno en un hilo aparte. Los archivos
temporales se guardan en backend/data/jobs/<id>/.
"""
from __future__ import annotations

import os
import shutil
import threading
import time
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict
from pathlib import Path
from typing import Dict

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .pipeline import separation_available, transcribe

VERSION = "0.1.0"
DATA = Path(os.environ.get("DRUMSTUDIO_DATA", Path(__file__).resolve().parent.parent / "data")) / "jobs"
DATA.mkdir(parents=True, exist_ok=True)
MAX_BYTES = 200 * 1024 * 1024
# Los trabajos (audio subido y stems) se borran pasado este tiempo.
JOB_TTL_S = int(os.environ.get("DRUMSTUDIO_JOB_TTL", 2 * 3600))
# Orígenes web permitidos (coma). En el servidor público se limita a la web de DrumStudio.
ORIGINS = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "*").split(",") if o.strip()]

app = FastAPI(title="DrumStudio transcription", version=VERSION)
# La app web se sirve desde otro origen (Vite en :5173, o la IP de la red local desde el iPad).
app.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=["*"], allow_headers=["*"])

executor = ThreadPoolExecutor(max_workers=1)
jobs: Dict[str, dict] = {}
lock = threading.Lock()


def _update(job_id: str, **kw) -> None:
    with lock:
        jobs[job_id].update(kw)


@app.get("/health")
def health():
    sep = separation_available()
    return {
        "ok": True,
        "version": VERSION,
        "separation": sep,
        "separation_model": "htdemucs" if sep else None,
        "classifier": "heurístico por bandas",
    }


def _run(job_id: str, path: Path, separate: bool) -> None:
    out_dir = path.parent
    _update(job_id, status="running", stage="Iniciando…", progress=0.01)
    try:
        res = transcribe(path, out_dir, separate, lambda p, s: _update(job_id, progress=round(p, 3), stage=s))
        _update(job_id, status="done", progress=1.0, stage="Listo", result=asdict(res))
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        _update(job_id, status="error", stage="Error", error=f"{type(e).__name__}: {e}")


def _cleanup() -> None:
    now = time.time()
    for d in DATA.iterdir():
        if d.is_dir() and now - d.stat().st_mtime > JOB_TTL_S:
            shutil.rmtree(d, ignore_errors=True)
            with lock:
                jobs.pop(d.name, None)


@app.post("/transcribe")
async def create_job(file: UploadFile = File(...), separate: str = Form("true")):
    _cleanup()
    job_id = uuid.uuid4().hex[:12]
    job_dir = DATA / job_id
    job_dir.mkdir(parents=True)
    # Se conserva la extensión (libsndfile lee WAV, FLAC, OGG y MP3).
    suffix = Path(file.filename or "").suffix.lower()
    dest = job_dir / ("input" + (suffix if suffix in (".wav", ".flac", ".ogg", ".mp3") else ".wav"))
    size = 0
    with dest.open("wb") as f:
        while chunk := await file.read(1 << 20):
            size += len(chunk)
            if size > MAX_BYTES:
                shutil.rmtree(job_dir, ignore_errors=True)
                raise HTTPException(413, "Archivo demasiado grande (máx. 200 MB).")
            f.write(chunk)
    with lock:
        jobs[job_id] = {"id": job_id, "status": "queued", "progress": 0.0, "stage": "En cola"}
    executor.submit(_run, job_id, dest, separate.lower() == "true")
    return {"job_id": job_id}


@app.get("/jobs/{job_id}")
def get_job(job_id: str):
    with lock:
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(404, "Trabajo no encontrado")
        return dict(job)


@app.get("/jobs/{job_id}/stems/{name}.wav")
def get_stem(job_id: str, name: str):
    if name not in ("drums", "backing") or not job_id.isalnum():
        raise HTTPException(404)
    p = DATA / job_id / f"{name}.wav"
    if not p.exists():
        raise HTTPException(404)
    return FileResponse(p, media_type="audio/wav")
