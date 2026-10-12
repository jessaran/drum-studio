import { playClick, playDrum } from '../audio/drumSynth'
import { stretchBuffer } from '../audio/stretchClient'
import type { PedalRole } from '../core/instruments'
import { bpmAtTick, computeBars, secondsToTick, type BarInfo } from '../core/timeline'
import type { DrumEvent, Song, StemRef, Timeline } from '../core/types'
import { PlaybackClock, type Anchor } from './clock'
import { LookaheadScheduler, type LoopRegion } from './scheduler'

/**
 * Motor de reproducción. Un único AudioContext y un único PlaybackClock
 * gobiernan audio, golpes, metrónomo, animaciones y partitura.
 */

export interface EngineState {
  ready: boolean
  playing: boolean
  countingIn: boolean
  rate: number
  /** true mientras se calcula el time-stretch (se reproduce con cambio de tono). */
  stretching: boolean
  loop: LoopRegion | null
  metronome: boolean
  guide: boolean
  countIn: boolean
  duration: number
  /** Posición de canción en el último cambio de estado (para la UI en pausa). */
  position: number
  loopCount: number
}

export interface Volumes {
  master: number
  backing: number
  drums: number
  mix: number
  metronome: number
  guide: number
}

export interface SyncStats {
  ticks: number
  /** Intervalos entre despertares del temporizador (ms). */
  intervals: number[]
  /** Antelación con que se programó cada sonido (ms). Negativo = tarde. */
  leads: number[]
  lateCount: number
}

interface Stem {
  ref: StemRef
  buffer: AudioBuffer
  stretched: Map<number, AudioBuffer>
}

interface Scheduled {
  node: AudioScheduledSourceNode
  when: number
}

type Listener = () => void

const SAFETY = 0.04 // margen para arrancar fuentes en el futuro (s)
const TIMER_MS = 25
const LOOKAHEAD = 0.2

export class Engine {
  ctx: AudioContext | null = null
  readonly clock = new PlaybackClock()
  readonly scheduler = new LookaheadScheduler(this.clock, { lookahead: LOOKAHEAD })
  private master!: GainNode
  private gains: Partial<Record<StemRef['kind'] | 'metronome' | 'guide' | 'preview', GainNode>> = {}
  private stems: Stem[] = []
  private active: AudioBufferSourceNode[] = []
  private scheduled: Scheduled[] = []
  private timer: number | null = null
  private listeners = new Set<Listener>()
  private snapshot: EngineState
  private timeline: Timeline | null = null
  private bars: BarInfo[] = []
  private beats: { time: number; downbeat: boolean }[] = []
  /** Eventos que se reproducen (según nivel de dificultad), ordenados por tiempo. */
  events: DrumEvent[] = []
  pedalRole: PedalRole = 'hiHatPedal'
  private audioOffset = 0
  /** Latencia visual calibrada por el usuario (ms): retrasa (+) o adelanta (−) lo visual. */
  visualLatencyMs = 0
  private countInUntil = -Infinity
  private stretchToken = 0
  volumes: Volumes = { master: 0.9, backing: 0.8, drums: 0.8, mix: 0.9, metronome: 0.6, guide: 0.7 }
  stats: SyncStats = { ticks: 0, intervals: [], leads: [], lateCount: 0 }
  private lastTickPerf = 0

  constructor() {
    this.snapshot = {
      ready: false,
      playing: false,
      countingIn: false,
      rate: 1,
      stretching: false,
      loop: null,
      metronome: false,
      guide: false,
      countIn: false,
      duration: 0,
      position: 0,
      loopCount: 0,
    }
    this.scheduler.addSource({
      items: this.beats,
      enabled: () => this.snapshot.metronome,
      emit: (b, when) => this.track(playClick(this.ctx!, this.gains.metronome!, when, b.downbeat), when),
    })
    this.scheduler.addSource({
      items: this.events,
      enabled: () => this.snapshot.guide,
      emit: (e, when) => {
        for (const n of playDrum(this.ctx!, this.gains.guide!, e.instrument, when, e.velocity, e.articulation, this.pedalRole)) this.track(n, when)
      },
    })
    this.scheduler.onLoopAnchor = (a) => {
      this.startSources(a.ctxTime, a.songPos)
      this.set({ loopCount: this.snapshot.loopCount + 1 })
    }
  }

  // ---------- suscripción para React (useSyncExternalStore) ----------
  subscribe = (l: Listener) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }
  getSnapshot = () => this.snapshot
  private set(p: Partial<EngineState>) {
    this.snapshot = { ...this.snapshot, ...p }
    for (const l of this.listeners) l()
  }

  // ---------- contexto de audio ----------
  /** Debe llamarse desde un gesto del usuario (requisito de iOS/Safari). */
  async ensureContext(): Promise<AudioContext> {
    if (!this.ctx) {
      // iOS: que el audio suene aunque el interruptor de silencio esté activado.
      const nav = navigator as Navigator & { audioSession?: { type: string } }
      if (nav.audioSession) {
        try {
          nav.audioSession.type = 'playback'
        } catch {
          /* no soportado */
        }
      }
      const ctx = new AudioContext({ latencyHint: 'interactive' })
      this.ctx = ctx
      this.master = ctx.createGain()
      this.master.connect(ctx.destination)
      for (const k of ['mix', 'drums', 'backing', 'metronome', 'guide', 'preview'] as const) {
        const g = ctx.createGain()
        g.connect(this.master)
        this.gains[k] = g
      }
      this.applyVolumes()
      this.set({ ready: true })
    }
    if (this.ctx.state !== 'running') await this.ctx.resume()
    return this.ctx
  }

  setVolumes(v: Partial<Volumes>) {
    this.volumes = { ...this.volumes, ...v }
    this.applyVolumes()
  }

  private applyVolumes() {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    const set = (g: GainNode | undefined, v: number) => g?.gain.setTargetAtTime(v * v, t, 0.015)
    set(this.master, this.volumes.master)
    set(this.gains.mix, this.volumes.mix)
    set(this.gains.drums, this.volumes.drums)
    set(this.gains.backing, this.volumes.backing)
    set(this.gains.metronome, this.volumes.metronome)
    set(this.gains.guide, this.volumes.guide)
    set(this.gains.preview, 0.8)
  }

  // ---------- carga ----------
  loadSong(song: Song, events: DrumEvent[], stems: { ref: StemRef; buffer: AudioBuffer }[]) {
    this.pause()
    this.timeline = song.timeline
    const maxTick = Math.max(secondsToTick(song.timeline, song.duration), 0)
    this.bars = computeBars(song.timeline, maxTick)
    this.beats.length = 0
    for (const b of this.bars) {
      for (let k = 0; k < b.num; k++) {
        const time = b.startTime + ((b.endTime - b.startTime) * k) / b.num
        if (time <= song.duration) this.beats.push({ time, downbeat: k === 0 })
      }
    }
    this.setEvents(events)
    this.pedalRole = song.pedalRole
    this.stems = stems.map((s) => ({ ...s, stretched: new Map() }))
    this.audioOffset = song.audio?.offset ?? 0
    this.scheduler.songEnd = song.duration
    this.clock.setPausedPosition(0)
    this.set({ duration: song.duration, position: 0, loop: null, loopCount: 0, guide: stems.length === 0 ? true : this.snapshot.guide })
    this.scheduler.loop = null
    if (this.snapshot.rate !== 1) void this.prepareStretch(this.snapshot.rate)
  }

  /** Sustituye los eventos (editor, nivel de dificultad) sin perder la posición. */
  setEvents(events: DrumEvent[]) {
    this.events.length = 0
    for (const e of [...events].sort((a, b) => a.time - b.time)) this.events.push(e)
    if (this.clock.playing) this.resync()
  }

  setAudioOffset(offset: number) {
    this.audioOffset = offset
    if (this.clock.playing) this.resync()
  }

  get offset() {
    return this.audioOffset
  }

  get hasAudio() {
    return this.stems.length > 0
  }

  // ---------- transporte ----------
  async play() {
    const ctx = await this.ensureContext()
    if (this.clock.playing) return
    let pos = this.clock.songPosAt(0)
    if (pos >= this.snapshot.duration - 0.05) pos = this.snapshot.loop?.start ?? 0
    if (this.snapshot.loop && (pos < this.snapshot.loop.start || pos >= this.snapshot.loop.end)) pos = this.snapshot.loop.start
    const now = ctx.currentTime
    let start = now + SAFETY
    if (this.snapshot.countIn && this.timeline) {
      const bpm = bpmAtTick(this.timeline, secondsToTick(this.timeline, pos))
      const beat = 60 / bpm / this.clock.rate
      for (let k = 0; k < 4; k++) this.track(playClick(ctx, this.gains.metronome!, start + k * beat, k === 0), start + k * beat)
      start += 4 * beat
      this.countInUntil = start
    } else this.countInUntil = -Infinity
    this.clock.start(start, pos, this.snapshot.rate)
    this.scheduler.reset(now)
    this.startSources(start, pos)
    this.startTimer()
    this.set({ playing: true, countingIn: this.countInUntil > now, position: pos })
  }

  pause() {
    if (!this.ctx || !this.clock.playing) return
    const now = this.ctx.currentTime
    // Congela en la posición AUDIBLE para que lo que se ve coincida con lo que se oyó.
    const pos = Math.max(0, Math.min(this.snapshot.duration, this.clock.songPosAt(this.audibleCtxTime())))
    this.clock.pause(now)
    this.clock.setPausedPosition(pos)
    this.stopSources(now)
    this.cancelScheduled(now)
    this.stopTimer()
    this.countInUntil = -Infinity
    this.set({ playing: false, countingIn: false, position: pos })
  }

  toggle() {
    if (this.clock.playing) this.pause()
    else void this.play()
  }

  seek(pos: number) {
    pos = Math.max(0, Math.min(this.snapshot.duration, pos))
    if (!this.ctx || !this.clock.playing) {
      this.clock.setPausedPosition(pos)
      this.set({ position: pos })
      return
    }
    const t = this.ctx.currentTime + SAFETY
    this.clock.pushAnchor({ ctxTime: t, songPos: pos, rate: this.clock.rate })
    this.cancelScheduled(t)
    this.scheduler.reset(this.ctx.currentTime)
    this.startSources(t, pos)
    this.set({ position: pos })
  }

  seekBar(index: number) {
    const b = this.bars[Math.max(0, Math.min(this.bars.length - 1, index))]
    if (b) this.seek(b.startTime)
  }

  /** Reprograma todo desde la posición actual (tras cambiar eventos, offset, bucle…). */
  private resync() {
    if (!this.ctx || !this.clock.playing) return
    const t = this.ctx.currentTime + SAFETY
    if (t < this.countInUntil) return
    this.seek(this.clock.songPosAt(t))
  }

  setRate(rate: number) {
    rate = Math.max(0.5, Math.min(1.5, Math.round(rate * 100) / 100))
    if (rate === this.clock.rate && rate === this.snapshot.rate) return
    if (!this.ctx || !this.clock.playing) {
      this.clock.setRateWhilePaused(rate)
      this.set({ rate })
      void this.prepareStretch(rate)
      return
    }
    const t = this.ctx.currentTime + SAFETY
    const pos = this.clock.songPosAt(t)
    this.clock.pushAnchor({ ctxTime: t, songPos: pos, rate })
    this.cancelScheduled(t)
    this.scheduler.reset(this.ctx.currentTime)
    this.startSources(t, pos)
    this.set({ rate })
    void this.prepareStretch(rate)
  }

  /** Calcula las versiones con time-stretch; al terminar sustituye las fuentes sin mover el reloj. */
  private async prepareStretch(rate: number) {
    if (!this.ctx || this.stems.length === 0 || rate === 1) {
      this.set({ stretching: false })
      return
    }
    const token = ++this.stretchToken
    const missing = this.stems.filter((s) => !s.stretched.has(rate))
    if (missing.length === 0) return
    this.set({ stretching: true })
    await Promise.all(missing.map(async (s) => s.stretched.set(rate, await stretchBuffer(this.ctx!, s.buffer, rate))))
    if (token !== this.stretchToken) return
    this.set({ stretching: false })
    if (this.clock.playing && this.clock.rate === rate && this.ctx) {
      const t = this.ctx.currentTime + SAFETY
      if (t >= this.countInUntil) this.startSources(t, this.clock.songPosAt(t))
    }
  }

  setLoop(loop: LoopRegion | null) {
    this.scheduler.loop = loop
    this.set({ loop, loopCount: 0 })
    if (!loop) {
      if (this.clock.playing) this.resync()
      return
    }
    const pos = this.clock.playing && this.ctx ? this.clock.songPosAt(this.ctx.currentTime + SAFETY) : this.clock.songPosAt(0)
    if (pos < loop.start || pos >= loop.end) this.seek(loop.start)
    else if (this.clock.playing) this.resync()
  }

  setMetronome(on: boolean) {
    this.set({ metronome: on })
    if (this.clock.playing) this.resync()
  }

  setGuide(on: boolean) {
    this.set({ guide: on })
    if (this.clock.playing) this.resync()
  }

  setCountIn(on: boolean) {
    this.set({ countIn: on })
  }

  /** Sonido inmediato de una pieza (modo demostración / clic en la batería). */
  async preview(instrument: DrumEvent['instrument'], velocity = 100, articulation?: string) {
    const ctx = await this.ensureContext()
    playDrum(ctx, this.gains.preview!, instrument, ctx.currentTime + 0.005, velocity, articulation, this.pedalRole)
  }

  // ---------- fuentes de audio ----------
  private startSources(at: number, songPos: number) {
    const ctx = this.ctx!
    this.stopSources(at)
    const rate = this.clock.rate
    for (const stem of this.stems) {
      const stretched = stem.stretched.get(rate)
      const buf = stretched ?? stem.buffer
      const audioTime = songPos + this.audioOffset
      let when = at
      let offset = stretched ? audioTime / rate : audioTime
      if (audioTime < 0) {
        when = at + -audioTime / rate
        offset = 0
      }
      if (offset >= buf.duration) continue
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.playbackRate.value = stretched ? 1 : rate
      src.connect(this.gains[stem.ref.kind]!)
      src.start(when, offset)
      this.active.push(src)
    }
  }

  private stopSources(at: number) {
    for (const s of this.active) {
      try {
        s.stop(at)
      } catch {
        /* ya detenida */
      }
    }
    this.active = []
  }

  private track(node: AudioScheduledSourceNode, when: number) {
    this.scheduled.push({ node, when })
    if (this.ctx) {
      const lead = (when - this.ctx.currentTime) * 1000
      this.stats.leads.push(lead)
      if (lead < 0) this.stats.lateCount++
      if (this.stats.leads.length > 2000) this.stats.leads.splice(0, 1000)
    }
  }

  /** Cancela sonidos programados que aún no han empezado (salto, pausa, cambio de velocidad). */
  private cancelScheduled(after: number) {
    const keep: Scheduled[] = []
    for (const s of this.scheduled) {
      if (s.when >= after - 0.001) {
        try {
          s.node.stop()
        } catch {
          /* ignore */
        }
      } else if (this.ctx && s.when > this.ctx.currentTime - 3) keep.push(s)
    }
    this.scheduled = keep
  }

  // ---------- temporizador ----------
  private startTimer() {
    this.stopTimer()
    this.lastTickPerf = performance.now()
    const tick = () => {
      if (!this.ctx) return
      const p = performance.now()
      this.stats.intervals.push(p - this.lastTickPerf)
      if (this.stats.intervals.length > 2000) this.stats.intervals.splice(0, 1000)
      this.lastTickPerf = p
      this.stats.ticks++
      this.scheduler.tick(this.ctx.currentTime)
      if (this.snapshot.countingIn && this.ctx.currentTime >= this.countInUntil) this.set({ countingIn: false })
      // Final de la canción (sin bucle): se detiene cuando se ha OÍDO el final.
      if (!this.snapshot.loop && this.clock.playing && this.clock.songPosAt(this.audibleCtxTime()) >= this.snapshot.duration) {
        this.pause()
        this.clock.setPausedPosition(this.snapshot.duration)
        this.set({ position: this.snapshot.duration })
      }
      if (this.scheduled.length > 512) this.scheduled = this.scheduled.filter((s) => s.when > this.ctx!.currentTime - 1)
    }
    this.timer = window.setInterval(tick, TIMER_MS)
    tick()
  }

  private stopTimer() {
    if (this.timer !== null) window.clearInterval(this.timer)
    this.timer = null
  }

  // ---------- posición para lo visual ----------
  /**
   * Tiempo del AudioContext que se está oyendo AHORA por los altavoces.
   * getOutputTimestamp() relaciona el reloj de audio con performance.now();
   * si no existe, se resta la latencia de salida declarada.
   */
  audibleCtxTime(): number {
    const ctx = this.ctx
    if (!ctx) return 0
    const ts = typeof ctx.getOutputTimestamp === 'function' ? ctx.getOutputTimestamp() : null
    let t: number
    if (ts && ts.contextTime !== undefined && ts.performanceTime !== undefined && ts.performanceTime > 0) {
      t = ts.contextTime + (performance.now() - ts.performanceTime) / 1000
      // Nunca por delante de lo ya procesado.
      t = Math.min(t, ctx.currentTime)
    } else {
      t = ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0)
    }
    return t
  }

  /** Posición de canción que debe MOSTRARSE en este frame (incluye calibración visual). */
  visualPosition(): number {
    if (!this.ctx || !this.clock.playing) return this.clock.songPosAt(0)
    const t = this.audibleCtxTime() - this.visualLatencyMs / 1000
    if (t < this.countInUntil) return this.clock.songPosAt(this.countInUntil)
    return this.clock.songPosAt(t)
  }

  /** Para la cuenta previa visual: fracción de pulso y número de pulso restantes. */
  countInState(): { beatsLeft: number } | null {
    if (!this.ctx || !this.clock.playing) return null
    const t = this.audibleCtxTime()
    if (t >= this.countInUntil) return null
    const bpm = this.timeline ? bpmAtTick(this.timeline, secondsToTick(this.timeline, this.clock.songPosAt(this.countInUntil))) : 120
    const beat = 60 / bpm / this.clock.rate
    return { beatsLeft: Math.ceil((this.countInUntil - t) / beat) }
  }

  get barList() {
    return this.bars
  }

  resetStats() {
    this.stats = { ticks: 0, intervals: [], leads: [], lateCount: 0 }
  }

  /** Para pruebas/diagnóstico. */
  currentAnchor(): Anchor | null {
    return this.ctx ? this.clock.anchorAt(this.ctx.currentTime) : null
  }
}

export const engine = new Engine()
