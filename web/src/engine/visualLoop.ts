/**
 * Bucle visual único (requestAnimationFrame). Cada frame lee UNA vez la
 * posición del reloj de reproducción y la reparte a todos los suscriptores
 * (batería, partitura, carril, contador): todos ven exactamente la misma
 * posición en el mismo frame. No guarda estado de React: los suscriptores
 * escriben directamente en el DOM/canvas.
 */

export interface Frame {
  /** Posición de canción visible (s). */
  pos: number
  rate: number
  playing: boolean
  /** performance.now() del frame. */
  now: number
  /** Intervalo con el frame anterior (ms). */
  dt: number
}

export interface FrameSource {
  subscribe(cb: (f: Frame) => void): () => void
}

export class VisualLoop implements FrameSource {
  private subs = new Set<(f: Frame) => void>()
  private raf = 0
  private last = 0
  /** Intervalos entre frames recientes (para medir jitter). */
  readonly frameIntervals: number[] = []
  private readonly read: () => { pos: number; rate: number; playing: boolean }

  constructor(read: () => { pos: number; rate: number; playing: boolean }) {
    this.read = read
  }

  subscribe(cb: (f: Frame) => void) {
    this.subs.add(cb)
    if (!this.raf) this.start()
    return () => {
      this.subs.delete(cb)
      if (this.subs.size === 0) this.stop()
    }
  }

  private start() {
    this.last = performance.now()
    const loop = (now: number) => {
      const dt = now - this.last
      this.last = now
      this.frameIntervals.push(dt)
      if (this.frameIntervals.length > 600) this.frameIntervals.splice(0, 300)
      const s = this.read()
      const f: Frame = { pos: s.pos, rate: s.rate, playing: s.playing, now, dt }
      for (const cb of this.subs) cb(f)
      this.raf = requestAnimationFrame(loop)
    }
    this.raf = requestAnimationFrame(loop)
  }

  private stop() {
    cancelAnimationFrame(this.raf)
    this.raf = 0
  }
}
