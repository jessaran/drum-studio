/**
 * Cambio de tempo sin cambiar el tono: WSOLA (Waveform Similarity Overlap-Add).
 *
 * Implementación propia (sin dependencias LGPL). Mantiene una relación lineal
 * exacta entre tiempo de entrada y de salida: la trama k se toma alrededor de
 * x = k·Hs·rate con una desviación máxima de ±tolerance muestras (≈5.8 ms a
 * 44.1 kHz), así que la sincronía con la partitura se conserva.
 *
 * Transitorios: WSOLA puede saltarse un golpe corto al acelerar (la búsqueda
 * prefiere continuar el silencio). Por eso se detectan los ataques y, en las
 * tramas que los contienen, se alinea la trama para que el ataque caiga
 * exactamente en su posición de salida (ataque/rate).
 *
 * Calidad: buena para práctica con batería; con rates extremos (0.5) se
 * perciben artefactos de "eco" en sonidos sostenidos, como en cualquier WSOLA.
 */

export interface StretchOptions {
  frame: number
  tolerance: number
  /** Diezmado para la búsqueda de similitud (acelera ~decim² veces). */
  decim: number
}

export const DEFAULT_STRETCH: StretchOptions = { frame: 1024, tolerance: 256, decim: 4 }

export function timeStretch(channels: Float32Array[], rate: number, opts: StretchOptions = DEFAULT_STRETCH): Float32Array[] {
  if (Math.abs(rate - 1) < 1e-6) return channels.map((c) => c.slice())
  const N = opts.frame
  const Hs = N / 2
  const tol = opts.tolerance
  const D = opts.decim
  const inLen = channels[0].length
  const outLen = Math.ceil(inLen / rate)
  const out = channels.map(() => new Float32Array(outLen + N))
  const norm = new Float32Array(outLen + N)

  // Ventana de Hann periódica (suma constante con solape del 50 %).
  const win = new Float32Array(N)
  for (let n = 0; n < N; n++) win[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N)

  // Señal mono diezmada para la búsqueda.
  const mono = new Float32Array(Math.ceil(inLen / D))
  for (let i = 0, j = 0; i < inLen; i += D, j++) {
    let s = 0
    for (const c of channels) s += c[i]
    mono[j] = s / channels.length
  }
  const L = Math.floor(Hs / D) // longitud de comparación (región de solape)
  const tolD = Math.floor(tol / D)

  const attacks = detectAttacks(mono, D)
  let ai = 0

  let prevSrc = 0
  const frames = Math.ceil(outLen / Hs) + 1
  for (let k = 0; k < frames; k++) {
    const ys = k * Hs
    const nominal = Math.round(ys * rate)
    let best = nominal
    // ¿Hay un ataque cuya posición de salida cae dentro de esta trama?
    while (ai < attacks.length && attacks[ai] / rate < ys - N / 4) ai++
    let locked = false
    for (let j = ai; j < attacks.length && attacks[j] / rate < ys + (3 * N) / 4; j++) {
      const target = attacks[j] / rate
      if (target >= ys - N / 4) {
        best = Math.round(attacks[j] - (target - ys))
        locked = true
        break
      }
    }
    if (k > 0 && !locked) {
      // Continuación natural de la trama anterior.
      const natural = Math.floor((prevSrc + Hs) / D)
      const nomD = Math.floor(nominal / D)
      let bestScore = -Infinity
      for (let d = -tolD; d <= tolD; d++) {
        const cand = nomD + d
        if (cand < 0 || cand + L >= mono.length || natural + L >= mono.length) continue
        let dot = 0
        let e = 1e-9
        for (let n = 0; n < L; n++) {
          const v = mono[cand + n]
          dot += v * mono[natural + n]
          e += v * v
        }
        const score = dot / Math.sqrt(e)
        if (score > bestScore) {
          bestScore = score
          best = cand * D
        }
      }
    }
    const src = Math.max(0, Math.min(best, inLen - 1))
    for (let ch = 0; ch < channels.length; ch++) {
      const inp = channels[ch]
      const o = out[ch]
      for (let n = 0; n < N; n++) {
        const si = src + n
        if (si >= inLen) break
        o[ys + n] += win[n] * inp[si]
      }
    }
    for (let n = 0; n < N; n++) norm[ys + n] += win[n]
    prevSrc = src
  }
  return out.map((o) => {
    const r = new Float32Array(outLen)
    for (let i = 0; i < outLen; i++) r[i] = norm[i] > 1e-3 ? o[i] / norm[i] : o[i]
    return r
  })
}

/** Ataques (índices de muestra) por aumento brusco de energía en bloques de 256 muestras. */
function detectAttacks(monoDecim: Float32Array, D: number): number[] {
  const B = Math.max(8, Math.floor(256 / D))
  const nb = Math.floor(monoDecim.length / B)
  const energy = new Float32Array(nb)
  let max = 0
  for (let b = 0; b < nb; b++) {
    let e = 0
    for (let n = 0; n < B; n++) {
      const v = monoDecim[b * B + n]
      e += v * v
    }
    energy[b] = e
    if (e > max) max = e
  }
  const out: number[] = []
  const floor = max * 1e-4
  for (let b = 1; b < nb; b++) {
    let prev = 0
    for (let k = 1; k <= 4 && b - k >= 0; k++) prev += energy[b - k]
    prev /= Math.min(4, b)
    if (energy[b] > floor && energy[b] > prev * 4) {
      // Refina al primer valor relevante del bloque.
      let pos = b * B
      const thr = Math.sqrt(energy[b] / B) * 0.5
      for (let n = 0; n < B; n++) if (Math.abs(monoDecim[b * B + n]) >= thr) { pos = b * B + n; break }
      const sample = pos * D
      if (out.length === 0 || sample - out[out.length - 1] > 2048) out.push(sample)
    }
  }
  return out
}
