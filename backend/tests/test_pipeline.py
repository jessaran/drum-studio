"""Validación de la transcripción con audio de referencia generado (npm run gen:samples en web/).

Umbrales deliberadamente modestos: miden que el pipeline funciona de extremo a
extremo, no que sea preciso con grabaciones reales (ver README: limitaciones).
"""
import json
from collections import defaultdict
from pathlib import Path

import pytest

from app.pipeline import transcribe
from evaluate import f_measure

SAMPLES = Path(__file__).resolve().parents[2] / "web" / "public" / "samples"
REF = SAMPLES / "primer-groove-reference.json"


def run(name, tmp_path):
    res = transcribe(SAMPLES / name, tmp_path, False, lambda p, s: None)
    ref = json.loads(REF.read_text())
    by_ref, by_est = defaultdict(list), defaultdict(list)
    for e in ref:
        by_ref[e["instrument"]].append(e["time"])
    for e in res.events:
        by_est[e["instrument"]].append(e["time"])
    return res, by_ref, by_est


@pytest.mark.skipif(not REF.exists(), reason="Ejecuta `npm run gen:samples` en web/ primero")
def test_drums_stem(tmp_path):
    res, by_ref, by_est = run("primer-groove-drums.wav", tmp_path)
    assert abs(res.bpm - 100) < 1.5
    assert res.downbeats and res.downbeats[0] < 0.1
    for inst, min_f in {"kick": 0.85, "snare": 0.7, "hiHat": 0.75, "crash": 0.6, "tom1": 0.6, "tom2": 0.6, "floorTom": 0.6}.items():
        _, _, f, _ = f_measure(by_ref[inst], by_est[inst])
        assert f >= min_f, f"{inst}: F={f:.2f} < {min_f}"
    for e in res.events:
        assert 0 <= e["confidence"] <= 1 and 1 <= e["velocity"] <= 127


@pytest.mark.skipif(not REF.exists(), reason="Ejecuta `npm run gen:samples` en web/ primero")
def test_mix_onsets_and_tempo(tmp_path):
    res, by_ref, by_est = run("primer-groove-mix.wav", tmp_path)
    assert abs(res.bpm - 100) < 1.5
    onset_ref = sorted({round(t, 3) for t in sum(by_ref.values(), [])})
    onset_est = sorted({round(t, 3) for t in sum(by_est.values(), [])})
    _, _, f, _ = f_measure(onset_ref, onset_est)
    assert f > 0.85
