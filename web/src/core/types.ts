import type { InstrumentId, PedalRole } from './instruments'

/** Origen de un golpe. `manual` = creado o corregido a mano en el editor. */
export type EventSource = 'demo' | 'midi' | 'score' | 'ai' | 'manual'

export interface DrumEvent {
  id: string
  instrument: InstrumentId
  /** Tiempo real de interpretación en segundos (lo que se usa para sonar y animar). */
  time: number
  /** Posición musical cuantizada en ticks (PPQ = timeline.ppq). Lo que usa la partitura. */
  tick: number
  /** Posición sin cuantizar en ticks (si la hay) para poder recuantizar. */
  rawTick?: number
  duration?: number
  /** 1..127 */
  velocity: number
  /** Compás (0-based), tiempo dentro del compás (0-based) y subdivisión (fracción del tiempo, 0..1). */
  bar: number
  beat: number
  subdivision: number
  source: EventSource
  /** Si fue editado a mano, origen previo. */
  originalSource?: EventSource
  /** 0..1, solo para eventos de transcripción automática. */
  confidence?: number
  /** Variante: open/closed/half (hi-hat), bell (ride), sidestick/rim (caja), china/splash. */
  articulation?: string
  /** Nota MIDI original, si procede. */
  midiNote?: number
}

export interface TempoPoint {
  tick: number
  bpm: number
}

export interface TimeSigPoint {
  /** Debe caer al inicio de un compás. */
  tick: number
  num: number
  den: number
}

export interface Timeline {
  ppq: number
  tempos: TempoPoint[]
  timeSigs: TimeSigPoint[]
}

export interface StemRef {
  id: string
  name: string
  /** 'mix' = mezcla completa, 'drums' = batería aislada, 'backing' = todo menos batería. */
  kind: 'mix' | 'drums' | 'backing'
  /** Clave en IndexedDB del blob de audio, o `generated:<id>` para audio sintetizado en el navegador. */
  blobKey: string
}

export interface SongAudio {
  stems: StemRef[]
  /** Segundos del archivo de audio en los que empieza el tiempo 0 de la partitura. */
  offset: number
}

export type SongOrigin = 'demo' | 'midi' | 'musicxml' | 'guitarpro' | 'audio' | 'transcription' | 'manual'

export interface Section {
  id: string
  name: string
  startBar: number
  /** Exclusivo. */
  endBar: number
}

export interface Song {
  id: string
  title: string
  artist: string
  origin: SongOrigin
  timeline: Timeline
  events: DrumEvent[]
  audio?: SongAudio
  /** Duración total en segundos (tiempo de partitura). */
  duration: number
  sections: Section[]
  pedalRole: PedalRole
  /** Variantes simplificadas de autor (si existen). Nunca se generan inventando golpes. */
  levels?: Partial<Record<'beginner' | 'intermediate', DrumEvent[]>>
  createdAt: number
  updatedAt: number
  /** Notas para el usuario sobre la procedencia (p. ej. limitaciones de la transcripción). */
  notes?: string
}
