"""
Pipeline de transcripción automática de batería.

  1. Carga del audio (WAV enviado por el navegador).
  2. Separación de la batería (Demucs htdemucs, opcional).
  3. Tempo y pulsos (librosa.beat) + estimación del primer tiempo fuerte.
  4. Detección de ataques (onsets) sobre la batería.
  5. Clasificación heurística por bandas de frecuencia, decaimiento y tono
     (multi-etiqueta: un ataque puede ser bombo + hi-hat a la vez).
  6. Eventos con tiempo (ms), pieza, velocity y confianza.

La cuantización, la partitura y la edición se hacen en el navegador.

IMPORTANTE: el clasificador es heurístico (sin modelo entrenado). Funciona
razonablemente con bombo, caja y hi-hat; confunde con frecuencia toms entre sí
y platillos (crash/ride/hi-hat abierto). La confianza devuelta refleja el
margen de la decisión, no una probabilidad calibrada.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Dict, List, Optional

import numpy as np

SR = 44100
HOP = 256
N_FFT = 2048

Progress = Callable[[float, str], None]


@dataclass
class TranscriptionResult:
    duration: float
    bpm: float
    beats: List[float]
    downbeats: List[float]
    events: List[dict]
    stems: Optional[Dict[str, str]]
    method: Dict[str, str]
    warnings: List[str] = field(default_factory=list)


# ---------------------------------------------------------------- separación


def separation_available() -> bool:
    try:
        import demucs  # noqa: F401
        import torch  # noqa: F401

        return True
    except Exception:
        return False


def separate_drums(audio: np.ndarray, sr: int, out_dir: Path, progress: Progress) -> Dict[str, Path]:
    """Separa batería y resto con Demucs (htdemucs). `audio`: (canales, muestras)."""
    import torch
    from demucs.apply import apply_model
    from demucs.pretrained import get_model
    import soundfile as sf

    progress(0.12, "Cargando modelo de separación (htdemucs)…")
    model = get_model("htdemucs")
    model.eval()
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    if audio.shape[0] == 1:
        audio = np.repeat(audio, 2, axis=0)
    if sr != model.samplerate:
        import librosa

        audio = librosa.resample(audio, orig_sr=sr, target_sr=model.samplerate)
        sr = model.samplerate
    wav = torch.tensor(audio, dtype=torch.float32)
    ref = wav.mean(0)
    wav = (wav - ref.mean()) / (ref.std() + 1e-8)
    progress(0.2, f"Separando batería ({device})…")
    with torch.no_grad():
        sources = apply_model(model, wav[None], device=device, split=True, overlap=0.25, progress=False)[0]
    sources = sources * (ref.std() + 1e-8) + ref.mean()
    names = model.sources  # ['drums', 'bass', 'other', 'vocals']
    drums = sources[names.index("drums")].cpu().numpy()
    backing = sum(sources[i] for i, n in enumerate(names) if n != "drums").cpu().numpy()
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = {"drums": out_dir / "drums.wav", "backing": out_dir / "backing.wav"}
    sf.write(paths["drums"], drums.T, sr, subtype="PCM_16")
    sf.write(paths["backing"], backing.T, sr, subtype="PCM_16")
    return paths


# ---------------------------------------------------------------- análisis


def _band_flux(S_db: np.ndarray, freqs: np.ndarray, lo: float, hi: float) -> np.ndarray:
    idx = (freqs >= lo) & (freqs < hi)
    band = S_db[idx]
    flux = np.maximum(0.0, np.diff(band, axis=1, prepend=band[:, :1])).mean(axis=0)
    return flux


def _band_energy(S: np.ndarray, freqs: np.ndarray, lo: float, hi: float) -> np.ndarray:
    idx = (freqs >= lo) & (freqs < hi)
    return S[idx].sum(axis=0)


def _norm(x: np.ndarray) -> np.ndarray:
    med = np.median(x)
    mad = np.median(np.abs(x - med)) + 1e-9
    return (x - med) / (1.4826 * mad)


def _sigmoid(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-x))


def estimate_tempo(y: np.ndarray, sr: int):
    import librosa

    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=HOP)
    tempo, beat_frames = librosa.beat.beat_track(onset_envelope=onset_env, sr=sr, hop_length=HOP, units="frames")
    tempo = float(np.atleast_1d(tempo)[0])
    beats = librosa.frames_to_time(beat_frames, sr=sr, hop_length=HOP)
    return tempo, beats


def estimate_downbeats(
    beats: np.ndarray,
    kick_at: Callable[[float], float],
    snare_at: Callable[[float], float],
    accents: List[float] = (),
    first_onset: Optional[float] = None,
    beats_per_bar: int = 4,
) -> List[float]:
    """Fase del compás: bombo en los tiempos 1 y 3, caja en 2 y 4 (heurística de pop/rock).
    Como 1 y 3 son simétricos, se desempata con los crash (suelen caer en el 1) y con
    el primer golpe de la canción. Después se extrapola hacia atrás."""
    if len(beats) < beats_per_bar:
        return list(map(float, beats[:1]))
    scores = []
    for phase in range(beats_per_bar):
        sc = 0.0
        for i in range(phase, len(beats), beats_per_bar):
            sc += kick_at(beats[i]) * 1.0
            if i + 2 < len(beats):
                sc += kick_at(beats[i + 2]) * 0.5
            for j in (1, 3):
                if i + j < len(beats):
                    sc += snare_at(beats[i + j]) * 0.8
        phase_beats = beats[phase::beats_per_bar]
        for a in accents:
            if np.min(np.abs(phase_beats - a)) < 0.07:
                sc += 2.0
        scores.append(sc)
    if first_onset is not None:
        period0 = float(np.median(np.diff(beats)))
        for phase in range(beats_per_bar):
            # ¿El primer golpe cae en un tiempo 1 de esta fase (extrapolada)?
            k = (first_onset - beats[phase]) / (period0 * beats_per_bar)
            if abs(k - round(k)) * period0 * beats_per_bar < 0.07:
                scores[phase] += 0.25 * max(scores)
    phase = int(np.argmax(scores))
    downs = [float(t) for t in beats[phase::beats_per_bar]]
    period = float(np.median(np.diff(beats))) if len(beats) > 1 else 0.5
    bar = period * beats_per_bar
    while downs and downs[0] - bar >= -0.05 * period:
        downs.insert(0, max(0.0, downs[0] - bar))
    return downs


def classify_onsets(y: np.ndarray, sr: int, progress: Progress, beat_period: float = 0.6) -> tuple:
    """Devuelve (eventos, fuerza_de_bombo(t)). Multi-etiqueta por ataque.

    Rasgos por ataque (robustos a silencios digitales): subida de energía en
    cada banda respecto a los ~25 ms anteriores, normalizada por el percentil
    99 de esa banda en toda la canción (≈ 0..1).
    """
    import librosa

    S = np.abs(librosa.stft(y, n_fft=N_FFT, hop_length=HOP)) ** 2
    freqs = librosa.fft_frequencies(sr=sr, n_fft=N_FFT)
    S_db = librosa.power_to_db(S + 1e-12, ref=np.max, top_db=80)
    bands = {"low": (30, 120), "lowmid": (120, 400), "mid": (400, 1500), "noise": (1500, 5000), "high": (6000, 16000)}
    E = {k: _band_energy(S, freqs, *v) for k, v in bands.items()}
    frames_per_s = sr / HOP

    def rise(k: str, f: int) -> float:
        e = E[k]
        before = e[max(0, f - 4): max(1, f - 1)].mean() if f > 1 else 0.0
        return float(max(0.0, e[f: f + 3].max() - before) / scale[k])

    progress(0.62, "Detectando golpes…")
    onset_env = librosa.onset.onset_strength(S=S_db, sr=sr, hop_length=HOP)
    onset_frames = librosa.onset.onset_detect(onset_envelope=onset_env, sr=sr, hop_length=HOP, units="frames", delta=0.08, wait=3)
    env_norm = onset_env / (np.percentile(onset_env, 99) + 1e-9)
    # Escala de cada banda: su energía típica en los ataques (percentil 75), no el pico global:
    # así un ride suave no queda eclipsado por los crash.
    peaks_at = lambda k: np.array([E[k][f: f + 3].max() for f in onset_frames]) if len(onset_frames) else E[k]
    scale = {k: float(np.percentile(peaks_at(k), 75)) + 1e-12 for k in bands}

    def high_decay(f: int) -> float:
        """Energía aguda que queda 150–450 ms después (percentil 20: ignora golpes posteriores)."""
        a = E["high"][f: f + 3].max() + 1e-12
        b0, b1 = f + int(0.15 * frames_per_s), f + int(0.45 * frames_per_s)
        if b1 >= len(E["high"]):
            return 0.0
        return float(np.percentile(E["high"][b0:b1], 20) / a)

    def low_pitch(f: int) -> float:
        sel = (freqs >= 60) & (freqs < 400)
        seg = S[sel, f + 1: f + 6].mean(axis=1)
        return float(freqs[sel][int(np.argmax(seg))]) if seg.size else 0.0

    events = []
    tom_candidates = []
    cymbals = []  # (índice en events, t, decay)
    progress(0.72, "Clasificando golpes…")
    for f in onset_frames:
        t = float(librosa.frames_to_time(f, sr=sr, hop_length=HOP))
        r = {k: rise(k, f) for k in bands}
        vel = int(np.clip(40 + 87 * min(1.0, env_norm[f]), 1, 127))
        n_over_h = float(E["noise"][f: f + 3].max() / (E["high"][f: f + 3].max() + 1e-12))
        hits = []
        if r["low"] > 0.12:
            hits.append(("kick", _sigmoid((r["low"] - 0.12) * 20)))
        tonal_low = r["lowmid"] > 0.12 and r["high"] < 0.08
        if tonal_low and n_over_h > 2.0:
            tom_candidates.append((t, low_pitch(f), _sigmoid((r["lowmid"] - 0.12) * 15) * 0.85, vel))
        elif r["noise"] > 0.1 and n_over_h > 0.38 and (r["mid"] > 0.05 or r["lowmid"] > 0.05):
            hits.append(("snare", _sigmoid((n_over_h - 0.38) * 10)))
        if r["high"] > 0.08:
            d = high_decay(f)
            if d < 0.01:
                hits.append(("hiHat", _sigmoid((r["high"] - 0.08) * 20)))
            else:
                cymbals.append((len(events) + len(hits), t, d))
                hits.append(("cymbal", 0.5))
        for inst, conf in hits:
            events.append({"time": round(t, 4), "instrument": inst, "velocity": vel, "confidence": round(float(conf), 3)})

    # Platillos largos: repetidos a menos de ~1 pulso → ride (patrón de tiempo); aislados → crash.
    for k, (idx, t, d) in enumerate(cymbals):
        prev_gap = t - cymbals[k - 1][1] if k > 0 else 99.0
        next_gap = cymbals[k + 1][1] - t if k + 1 < len(cymbals) else 99.0
        if min(prev_gap, next_gap) <= beat_period * 1.05:
            events[idx]["instrument"] = "ride"
            events[idx]["confidence"] = 0.55
        else:
            events[idx]["instrument"] = "crash"
            events[idx]["confidence"] = 0.6

    # Toms: agrupa por tono en hasta 3 grupos (agudo → tom1, medio → tom2, grave → floorTom).
    if tom_candidates:
        pitches = np.array([c[1] for c in tom_candidates])
        k = int(min(3, len(np.unique(np.round(pitches / 10)))))
        if k <= 1:
            names = ["tom2"] * len(pitches)
        else:
            centers = np.quantile(pitches, np.linspace(0.1, 0.9, k))
            for _ in range(25):
                labels = np.argmin(np.abs(pitches[:, None] - centers[None]), axis=1)
                centers = np.array([pitches[labels == i].mean() if np.any(labels == i) else centers[i] for i in range(k)])
            order = ["tom1", "tom2", "floorTom"] if k == 3 else ["tom1", "floorTom"]
            rank = {int(c): order[i] for i, c in enumerate(np.argsort(-centers))}
            names = [rank[int(l)] for l in labels]
        for (t, _p, conf, vel), name in zip(tom_candidates, names):
            events.append({"time": round(t, 4), "instrument": name, "velocity": vel, "confidence": round(float(conf), 3)})

    events.sort(key=lambda e: (e["time"], e["instrument"]))

    def kick_strength_at(t: float) -> float:
        f = int(librosa.time_to_frames(t, sr=sr, hop_length=HOP))
        return rise("low", f) if 0 <= f < len(E["low"]) - 3 else 0.0

    def snare_strength_at(t: float) -> float:
        f = int(librosa.time_to_frames(t, sr=sr, hop_length=HOP))
        return rise("noise", f) if 0 <= f < len(E["noise"]) - 3 else 0.0

    return events, kick_strength_at, snare_strength_at


def transcribe(path: Path, out_dir: Path, separate: bool, progress: Progress) -> TranscriptionResult:
    import librosa
    import soundfile as sf

    warnings: List[str] = []
    progress(0.02, "Leyendo audio…")
    audio, sr = sf.read(str(path), always_2d=True, dtype="float32")
    audio = audio.T  # (canales, muestras)
    duration = audio.shape[1] / sr
    mono_mix = audio.mean(axis=0)
    if sr != SR:
        mono_mix = librosa.resample(mono_mix, orig_sr=sr, target_sr=SR)

    stems: Optional[Dict[str, str]] = None
    drums = mono_mix
    method = {"separación": "ninguna", "onsets": "librosa onset_detect", "clasificador": "heurístico por bandas (sin modelo)", "tempo": "librosa beat_track"}
    if separate:
        if separation_available():
            try:
                paths = separate_drums(audio, sr, out_dir, progress)
                d, dsr = sf.read(str(paths["drums"]), always_2d=True, dtype="float32")
                drums = d.mean(axis=1)
                if dsr != SR:
                    drums = librosa.resample(drums, orig_sr=dsr, target_sr=SR)
                stems = {k: f"/jobs/{out_dir.name}/stems/{k}.wav" for k in paths}
                method["separación"] = "Demucs htdemucs"
            except Exception as e:  # pragma: no cover - depende del entorno
                warnings.append(f"La separación falló ({e}); se analiza la mezcla completa.")
        else:
            warnings.append("Demucs no está instalado: se analiza la mezcla completa (menos preciso). Ver backend/README.")

    progress(0.55, "Estimando tempo…")
    bpm, beats = estimate_tempo(mono_mix, SR)
    period = float(np.median(np.diff(beats))) if len(beats) > 1 else 60.0 / max(bpm, 1)
    events, kick_at, snare_at = classify_onsets(drums, SR, progress, beat_period=period)
    crashes = [e["time"] for e in events if e["instrument"] == "crash"]
    downbeats = estimate_downbeats(beats, kick_at, snare_at, crashes, events[0]["time"] if events else None)
    progress(0.98, "Terminando…")
    return TranscriptionResult(
        duration=float(duration),
        bpm=float(bpm),
        beats=[float(b) for b in beats],
        downbeats=downbeats,
        events=events,
        stems=stems,
        method=method,
        warnings=warnings,
    )
