"""
Evalúa la transcripción contra una referencia conocida (F-measure por pieza, tolerancia 50 ms).

  .venv/bin/python evaluate.py ../web/public/samples/primer-groove-mix.wav ../web/public/samples/primer-groove-reference.json

La referencia de la demo está en tiempos de partitura; el audio de la demo empieza en 0, así que coinciden.
"""
import json
import sys
from collections import defaultdict
from pathlib import Path
import tempfile

from app.pipeline import transcribe

TOL = 0.05


def f_measure(ref, est):
    used = set()
    tp = 0
    for t in ref:
        best = None
        for j, u in enumerate(est):
            if j in used or abs(u - t) > TOL:
                continue
            if best is None or abs(u - t) < abs(est[best] - t):
                best = j
        if best is not None:
            used.add(best)
            tp += 1
    p = tp / len(est) if est else 0.0
    r = tp / len(ref) if ref else 0.0
    f = 2 * p * r / (p + r) if p + r else 0.0
    return p, r, f, tp


def main():
    audio, ref_path = Path(sys.argv[1]), Path(sys.argv[2])
    separate = "--separate" in sys.argv
    ref = json.loads(ref_path.read_text())
    with tempfile.TemporaryDirectory() as d:
        res = transcribe(audio, Path(d), separate, lambda p, s: None)
    by_ref, by_est = defaultdict(list), defaultdict(list)
    for e in ref:
        by_ref[e["instrument"]].append(e["time"])
    for e in res.events:
        by_est[e["instrument"]].append(e["time"])
    print(f"Tempo estimado: {res.bpm:.1f} BPM · primer tiempo fuerte: {res.downbeats[0] if res.downbeats else '-'} s · método: {res.method}")
    print(f"{'pieza':<10}{'ref':>6}{'est':>6}{'P':>7}{'R':>7}{'F':>7}")
    all_ref = []
    all_est = []
    for inst in sorted(set(by_ref) | set(by_est)):
        p, r, f, _ = f_measure(by_ref[inst], by_est[inst])
        print(f"{inst:<10}{len(by_ref[inst]):>6}{len(by_est[inst]):>6}{p:>7.2f}{r:>7.2f}{f:>7.2f}")
    onset_ref = sorted({round(t, 3) for t in sum(by_ref.values(), [])})
    onset_est = sorted({round(t, 3) for t in sum(by_est.values(), [])})
    p, r, f, _ = f_measure(onset_ref, onset_est)
    print(f"{'(ataques)':<10}{len(onset_ref):>6}{len(onset_est):>6}{p:>7.2f}{r:>7.2f}{f:>7.2f}")


if __name__ == "__main__":
    main()
