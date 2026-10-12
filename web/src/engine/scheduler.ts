import { PlaybackClock, type Anchor } from './clock'

/**
 * Scheduler con lookahead (patrón "A Tale of Two Clocks").
 *
 * Un temporizador poco preciso (setInterval / worker, ~25 ms) solo sirve para
 * despertar; los sonidos se programan con antelación en tiempos EXACTOS del
 * reloj de audio calculados con el reloj de reproducción. La imprecisión del
 * temporizador no afecta a cuándo suena nada, solo a con cuánta antelación se
 * programa.
 *
 * Ventanas semiabiertas [desde, hasta) en tiempo de AudioContext: cada elemento
 * se programa exactamente una vez, aunque el temporizador llegue tarde, se
 * salte ciclos o el usuario salte/cambie la velocidad.
 */

export interface TimedItem {
  /** Tiempo de canción (s). */
  time: number
}

export interface LoopRegion {
  start: number
  end: number
}

export interface SchedulerSource<T extends TimedItem> {
  /** Elementos ordenados por tiempo. */
  items: T[]
  emit: (item: T, ctxTime: number) => void
  enabled: () => boolean
}

export interface SchedulerOptions {
  /** Antelación con la que se programa (s). */
  lookahead: number
}

export class LookaheadScheduler {
  private scheduledUntil = -Infinity
  private sources: SchedulerSource<TimedItem>[] = []
  loop: LoopRegion | null = null
  /** Se llama cuando el scheduler crea un ancla de bucle (para reprogramar el audio). */
  onLoopAnchor: ((a: Anchor) => void) | null = null
  /** Se llama cuando la canción llega al final (sin bucle). */
  songEnd = Infinity
  onSongEnd: ((ctxTime: number) => void) | null = null
  private endNotified = false
  readonly opts: SchedulerOptions
  private readonly clock: PlaybackClock

  constructor(clock: PlaybackClock, opts: SchedulerOptions) {
    this.clock = clock
    this.opts = opts
  }

  addSource<T extends TimedItem>(src: SchedulerSource<T>): void {
    this.sources.push(src as unknown as SchedulerSource<TimedItem>)
  }

  clearSources(): void {
    this.sources = []
  }

  /** Reinicia la ventana (tras Play, salto o cambio de velocidad). */
  reset(fromCtxTime: number): void {
    this.scheduledUntil = fromCtxTime
    this.endNotified = false
  }

  /** Llamar periódicamente con el tiempo actual del AudioContext. */
  tick(nowCtx: number): void {
    if (!this.clock.playing) return
    const until = nowCtx + this.opts.lookahead
    if (until <= this.scheduledUntil) return
    let from = this.scheduledUntil
    // Recorre los tramos de anclas dentro de la ventana; un bucle puede crear anclas nuevas en el camino.
    let guard = 0
    while (from < until && guard++ < 64) {
      const a = this.clock.anchorAt(from)
      if (!a) break
      const next = this.clock.anchorsBetween(from, until)[0]
      let segEnd = next ? next.ctxTime : until
      // ¿Cruza el final del bucle en este tramo?
      if (this.loop && this.loop.end > this.loop.start) {
        const loopEndCtx = PlaybackClock.ctxTimeFor(a, this.loop.end)
        const segStartPos = a.songPos + (Math.max(from, a.ctxTime) - a.ctxTime) * a.rate
        if (segStartPos < this.loop.end && loopEndCtx <= segEnd && loopEndCtx >= from) {
          this.emitRange(a, from, loopEndCtx)
          const anchor: Anchor = { ctxTime: loopEndCtx, songPos: this.loop.start, rate: a.rate }
          this.clock.pushAnchor(anchor)
          this.onLoopAnchor?.(anchor)
          from = loopEndCtx
          continue
        }
      }
      if (!this.loop && !this.endNotified) {
        const endCtx = PlaybackClock.ctxTimeFor(a, this.songEnd)
        if (endCtx >= from && endCtx < segEnd) {
          segEnd = endCtx
          this.emitRange(a, from, segEnd)
          this.endNotified = true
          this.onSongEnd?.(endCtx)
          from = segEnd
          break
        }
      }
      this.emitRange(a, from, segEnd)
      from = segEnd
    }
    this.scheduledUntil = Math.max(this.scheduledUntil, until)
  }

  private emitRange(a: Anchor, fromCtx: number, toCtx: number): void {
    if (toCtx <= fromCtx) return
    const startCtx = Math.max(fromCtx, a.ctxTime)
    const p0 = a.songPos + (startCtx - a.ctxTime) * a.rate
    const p1 = a.songPos + (toCtx - a.ctxTime) * a.rate
    // Si el tramo empieza en el propio ancla, incluimos los elementos exactamente en p0.
    for (const src of this.sources) {
      if (!src.enabled()) continue
      const items = src.items
      let i = lowerBound(items, p0)
      for (; i < items.length && items[i].time < p1; i++) {
        src.emit(items[i], PlaybackClock.ctxTimeFor(a, items[i].time))
      }
    }
  }
}

export function lowerBound<T extends TimedItem>(items: T[], time: number): number {
  let lo = 0
  let hi = items.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (items[mid].time < time) lo = mid + 1
    else hi = mid
  }
  return lo
}
