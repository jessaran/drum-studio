import { INSTRUMENT_IDS, type InstrumentId } from '../../core/instruments'

/**
 * Lógica de animación de la batería, sin React.
 *
 * El estado visual de cada pieza se CALCULA en cada frame a partir de la
 * posición de reproducción (no se lanzan animaciones con temporizadores):
 *   transcurrido = (posición − tiempo del último golpe) / velocidad
 * Así, pausar congela la animación, saltar la recalcula y cambiar la velocidad
 * no la desincroniza. Solo se escriben `transform` y `opacity` (baratos de
 * componer en la GPU) y solo cuando cambian.
 */

export interface KitEvent {
  instrument: InstrumentId
  /** Tiempo en segundos (reloj del reproductor). */
  time: number
  velocity: number
}

export interface PieceElements {
  body: SVGGElement
  flash: SVGElement
  pulse: SVGElement
  glow: SVGElement
  approach: SVGElement
  /** Centro (para transform-origin). */
  cx: number
  cy: number
}

export interface AnimatorOptions {
  /** Duración del golpe (ms), 120–180 recomendado. */
  durationMs: number
  /** Agrandamiento máximo (0.12 = 12 %). */
  scale: number
  /** Ventana de anticipación (s reales) para el anillo del próximo golpe; 0 = desactivado. */
  approachSec: number
}

export const DEFAULT_ANIMATOR: AnimatorOptions = { durationMs: 150, scale: 0.12, approachSec: 1.0 }

interface Cache {
  /** Dentro de la ventana de animación del golpe. */
  active: boolean
  scale: number
  flash: number
  pulseScale: number
  pulseOpacity: number
  glow: number
  approachScale: number
  approachOpacity: number
}

export class KitAnimator {
  private els: Partial<Record<InstrumentId, PieceElements>> = {}
  private cache: Partial<Record<InstrumentId, Cache>> = {}
  /** Tiempos ordenados por instrumento (s) y velocidades. */
  private times: Partial<Record<InstrumentId, Float64Array>> = {}
  private vels: Partial<Record<InstrumentId, Uint8Array>> = {}
  /** Golpes manuales: performance.now() del golpe. */
  private manual: Partial<Record<InstrumentId, { t: number; vel: number }>> = {}
  opts: AnimatorOptions

  constructor(opts: AnimatorOptions = DEFAULT_ANIMATOR) {
    this.opts = { ...opts }
  }

  register(id: InstrumentId, els: PieceElements | null) {
    if (els) {
      this.els[id] = els
      for (const el of [els.body, els.pulse, els.glow, els.approach]) el.style.transformOrigin = `${els.cx}px ${els.cy}px`
    } else delete this.els[id]
    delete this.cache[id]
  }

  setEvents(events: KitEvent[]) {
    const by: Partial<Record<InstrumentId, KitEvent[]>> = {}
    for (const e of events) (by[e.instrument] ??= []).push(e)
    this.times = {}
    this.vels = {}
    for (const id of INSTRUMENT_IDS) {
      const arr = (by[id] ?? []).sort((a, b) => a.time - b.time)
      this.times[id] = Float64Array.from(arr.map((e) => e.time))
      this.vels[id] = Uint8Array.from(arr.map((e) => e.velocity))
    }
  }

  /** Activa una pieza ya (clic, prueba o motor externo). */
  trigger(id: InstrumentId, velocity = 100, now = performance.now()) {
    this.manual[id] = { t: now, vel: velocity }
  }

  /**
   * Dibuja el estado de todas las piezas.
   * @param pos posición de reproducción (s) o null si no hay reproductor
   * @param rate velocidad (para convertir a tiempo real)
   */
  render(pos: number | null, rate: number, now: number) {
    const dur = this.opts.durationMs
    for (const id of INSTRUMENT_IDS) {
      const els = this.els[id]
      if (!els) continue
      let elapsed = Infinity
      let vel = 100
      let nextIn = Infinity
      const times = this.times[id]
      if (pos !== null && times && times.length) {
        const i = upperBound(times, pos) - 1
        if (i >= 0) {
          elapsed = ((pos - times[i]) / rate) * 1000
          vel = this.vels[id]![i]
        }
        if (i + 1 < times.length) nextIn = (times[i + 1] - pos) / rate
      }
      const m = this.manual[id]
      if (m) {
        const e = now - m.t
        if (e < elapsed) {
          elapsed = e
          vel = m.vel
        }
        if (e > dur * 3) delete this.manual[id]
      }
      this.apply(id, els, elapsed, vel, nextIn, dur)
    }
  }

  private apply(id: InstrumentId, els: PieceElements, elapsed: number, vel: number, nextIn: number, dur: number) {
    const v = 0.55 + 0.45 * Math.min(1, vel / 127)
    // El brillo es instantáneo (máximo en el frame del golpe) y decae; el
    // agrandamiento tiene una subida muy corta (15 %) para que se perciba como impacto.
    let up = 0
    let decay = 0
    if (elapsed >= 0 && elapsed < dur) {
      const p = elapsed / dur
      decay = Math.pow(1 - p, 1.5)
      up = p < 0.15 ? 0.6 + 0.4 * (p / 0.15) : Math.pow(1 - (p - 0.15) / 0.85, 2)
    }
    const pulseDur = dur * 2
    let pulseScale = 1
    let pulseOpacity = 0
    if (elapsed >= 0 && elapsed < pulseDur) {
      const p = elapsed / pulseDur
      pulseScale = 1 + 0.32 * Math.sqrt(p)
      pulseOpacity = (1 - p) * 0.85 * v
    }
    let approachScale = 1
    let approachOpacity = 0
    const L = this.opts.approachSec
    if (L > 0 && nextIn > 0.02 && nextIn < L) {
      const q = nextIn / L
      approachScale = 1.04 + 0.55 * q
      approachOpacity = (1 - q) * 0.9
    }
    const next: Cache = {
      active: elapsed >= 0 && elapsed < dur,
      scale: 1 + this.opts.scale * up * v,
      flash: decay * v,
      pulseScale,
      pulseOpacity,
      glow: decay * v,
      approachScale,
      approachOpacity,
    }
    const prev = this.cache[id]
    const r = (x: number) => Math.round(x * 1000) / 1000
    if (!prev || r(prev.scale) !== r(next.scale)) els.body.style.transform = `scale(${r(next.scale)})`
    if (!prev || r(prev.flash) !== r(next.flash)) els.flash.style.opacity = String(r(next.flash))
    if (!prev || r(prev.glow) !== r(next.glow)) {
      els.glow.style.opacity = String(r(next.glow))
      els.glow.style.transform = `scale(${r(1 + 0.25 * next.glow)})`
    }
    if (!prev || r(prev.pulseScale) !== r(next.pulseScale) || r(prev.pulseOpacity) !== r(next.pulseOpacity)) {
      els.pulse.style.transform = `scale(${r(next.pulseScale)})`
      els.pulse.style.opacity = String(r(next.pulseOpacity))
    }
    if (!prev || r(prev.approachScale) !== r(next.approachScale) || r(prev.approachOpacity) !== r(next.approachOpacity)) {
      els.approach.style.transform = `scale(${r(next.approachScale)})`
      els.approach.style.opacity = String(r(next.approachOpacity))
    }
    this.cache[id] = next
  }

  /** Estado actual (para pruebas y diagnóstico). */
  activeInstruments(): InstrumentId[] {
    return INSTRUMENT_IDS.filter((id) => this.cache[id]?.active ?? false)
  }
}

export function upperBound(arr: Float64Array, x: number): number {
  let lo = 0
  let hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid] <= x) lo = mid + 1
    else hi = mid
  }
  return lo
}
