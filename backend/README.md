---
title: DrumStudio Transcripción
emoji: 🥁
colorFrom: yellow
colorTo: purple
sdk: docker
app_port: 7860
pinned: false
license: mit
short_description: Transcripción automática de batería para DrumStudio
---

# Servicio de transcripción de DrumStudio

API que separa la batería de una canción (Demucs htdemucs), detecta los golpes y los clasifica por pieza. La usa la app web DrumStudio; no tiene interfaz propia.

- `GET /health` · `POST /transcribe` (multipart: `file`, `separate`) · `GET /jobs/{id}` · `GET /jobs/{id}/stems/{drums|backing}.wav`
- Los audios subidos y los stems se borran automáticamente a las 2 h (`DRUMSTUDIO_JOB_TTL`).
- CORS limitado por la variable `ALLOWED_ORIGINS` (configurada en el Space).

Local: `./run.sh` (puerto 8000). Pruebas: `.venv/bin/python -m pytest -q`.

El clasificador es heurístico (sin modelo entrenado): ver limitaciones en el README del proyecto.
