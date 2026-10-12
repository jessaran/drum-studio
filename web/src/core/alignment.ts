/**
 * Alineación audio ↔ MIDI/partitura.
 *
 * offset = segundo del audio en el que cae el tiempo 0 de la partitura
 * (audioTime = songTime + offset).
 *
 * La alineación automática busca el offset que hace coincidir los golpes del
 * MIDI con los ataques del audio: envolvente de ataques (flujo de energía
 * logarítmica, 5 ms) correlacionada con el tren de golpes, y refinado a 1 ms.
 * Es un punto de partida: el usuario termina de ajustarlo arrastrando.
 */

export interface Peaks {
  /** Mínimo y máximo por bloque de `block` muestras. */
  min: Float32Array
  max: Float32Array
  block: number
  sampleRate: number
  /** Señal mono completa (para dibujar con zoom extremo). */
  mono: Float32Array
}

export function toMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0]
  const n = channels[0].length
  const out = new Float32Array(n)
  for (const c of channels) for (let i = 0; i < n; i++) out[i] += c[i] / channels.length
  return out
}

export function computePeaks(mono: Float32Array, sampleRate: number, block = 64): Peaks {
  const nb = Math.ceil(mono.length / block)
  const min = new Float32Array(nb)
  const max = new Float32Array(nb)
  for (let b = 0; b < nb; b++) {
    let lo = 0
    let hi = 0
    const end = Math.min(mono.length, (b + 1) * block)
    for (let i = b * block; i < end; i++) {
      const v = mono[i]
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    min[b] = lo
    max[b] = hi
  }
  return { min, max, block, sampleRate, mono }
}

/** Envolvente de ataques: subida de energía (log) por trama de `hop` muestras. */
export function onsetEnvelope(mono: Float32Array, hop: number): Float32Array {
  const n = Math.floor(mono.length / hop)
  const env = new Float32Array(n)
  let prev = Math.log(1e-8)
  let prevSample = 0
  for (let k = 0; k < n; k++) {
    let e = 0
    // Diferencia de primer orden: atenúa graves sostenidos (bajo) y realza ataques.
    for (let i = k * hop; i < (k + 1) * hop; i++) {
      const d = mono[i] - prevSample
      prevSample = mono[i]
      e += d * d
    }
    const le = Math.log(e / hop + 1e-8)
    env[k] = Math.max(0, le - prev)
    prev = le
  }
  return env
}

interface HitTime {
  time: number
  velocity: number
}

function score(env: Float32Array, hits: HitTime[], hopSec: number, offset: number, spread: number): number {
  let s = 0
  for (const h of hits) {
    const f = Math.round((h.time + offset) / hopSec)
    let best = 0
    for (let d = -spread; d <= spread; d++) {
      const v = env[f + d]
      if (v !== undefined && v > best) best = v
    }
    s += best * (0.5 + h.velocity / 254)
  }
  return s
}

/**
 * Offset que mejor alinea los golpes con los ataques del audio.
 * @param range [mín, máx] de offsets a probar (s)
 */
export function autoAlign(mono: Float32Array, sampleRate: number, hits: HitTime[], range: [number, number]): { offset: number; confidence: number } {
  if (hits.length === 0) return { offset: 0, confidence: 0 }
  // Para no tardar con canciones largas: los primeros ~400 golpes bastan.
  const sample = hits.length > 400 ? hits.slice(0, 400) : hits
  // 1) Búsqueda gruesa a 5 ms.
  const hopC = Math.round(sampleRate * 0.005)
  const envC = onsetEnvelope(mono, hopC)
  const hopSecC = hopC / sampleRate
  let best = range[0]
  let bestScore = -1
  const scores: number[] = []
  for (let o = range[0]; o <= range[1]; o += hopSecC) {
    const sc = score(envC, sample, hopSecC, o, 1)
    scores.push(sc)
    if (sc > bestScore) {
      bestScore = sc
      best = o
    }
  }
  // 2) Refinado a 1 ms alrededor del mejor.
  const hopF = Math.round(sampleRate * 0.001)
  const envF = onsetEnvelope(mono, hopF)
  const hopSecF = hopF / sampleRate
  let fine = best
  let fineScore = -1
  for (let o = best - 0.008; o <= best + 0.008; o += hopSecF) {
    const sc = score(envF, sample, hopSecF, o, 0)
    if (sc > fineScore) {
      fineScore = sc
      fine = o
    }
  }
  // Confianza: cuánto destaca el máximo sobre la media de la búsqueda.
  const mean = scores.reduce((a, b) => a + b, 0) / Math.max(1, scores.length)
  const sd = Math.sqrt(scores.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, scores.length))
  const z = sd > 0 ? (bestScore - mean) / sd : 0
  return { offset: Math.round(fine * 1000) / 1000, confidence: Math.max(0, Math.min(1, (z - 3) / 5)) }
}
