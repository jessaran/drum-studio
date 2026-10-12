/**
 * Reloj de reproducción único.
 *
 * La posición de la canción (segundos de partitura) es siempre una función del
 * reloj del AudioContext:
 *
 *     songPos(t) = anchor.songPos + (t - anchor.ctxTime) * anchor.rate
 *
 * Un "ancla" se crea al dar Play, al saltar, al cambiar la velocidad o al
 * volver al inicio de un bucle. Las anclas pueden estar en el futuro (p. ej. el
 * salto de bucle se programa por adelantado con exactitud de muestra), por eso
 * se guarda una lista ordenada y no un único valor.
 *
 * Audio, eventos, animaciones, cursor de partitura y metrónomo leen esta misma
 * función: no hay temporizadores independientes que puedan desincronizarse.
 */

export interface Anchor {
  ctxTime: number
  songPos: number
  rate: number
}

export class PlaybackClock {
  private anchors: Anchor[] = []
  private pausedPos = 0
  private _playing = false
  private _rate = 1

  get playing(): boolean {
    return this._playing
  }

  get rate(): number {
    return this._rate
  }

  /** Inicia la reproducción: en `ctxTime` la canción estará en `songPos`. */
  start(ctxTime: number, songPos: number, rate = this._rate): Anchor {
    this._rate = rate
    this._playing = true
    const a = { ctxTime, songPos, rate }
    this.anchors = [a]
    return a
  }

  /** Detiene en el instante `ctxTime` y congela la posición. */
  pause(ctxTime: number): number {
    if (this._playing) this.pausedPos = this.songPosAt(ctxTime)
    this._playing = false
    this.anchors = []
    return this.pausedPos
  }

  /** Posición congelada (en pausa). */
  setPausedPosition(pos: number): void {
    this.pausedPos = pos
  }

  setRateWhilePaused(rate: number): void {
    this._rate = rate
  }

  /** Inserta un ancla futura (bucle) o presente (salto/velocidad durante la reproducción). */
  pushAnchor(a: Anchor): void {
    this._rate = a.rate
    // Descarta anclas posteriores (quedarían invalidadas por esta).
    this.anchors = this.anchors.filter((x) => x.ctxTime < a.ctxTime)
    this.anchors.push(a)
    // Mantiene la lista corta: basta con las anclas recientes.
    if (this.anchors.length > 8) this.anchors.splice(0, this.anchors.length - 8)
  }

  anchorAt(ctxTime: number): Anchor | null {
    if (this.anchors.length === 0) return null
    let a = this.anchors[0]
    for (const x of this.anchors) if (x.ctxTime <= ctxTime) a = x
    return a
  }

  /** Anclas que empiezan dentro de (t0, t1]. */
  anchorsBetween(t0: number, t1: number): Anchor[] {
    return this.anchors.filter((a) => a.ctxTime > t0 && a.ctxTime <= t1)
  }

  songPosAt(ctxTime: number): number {
    if (!this._playing) return this.pausedPos
    const a = this.anchorAt(ctxTime)
    if (!a) return this.pausedPos
    return a.songPos + (ctxTime - a.ctxTime) * a.rate
  }

  /** Instante del reloj de audio en que la canción pasará por `songPos` según el ancla `a`. */
  static ctxTimeFor(a: Anchor, songPos: number): number {
    return a.ctxTime + (songPos - a.songPos) / a.rate
  }
}
