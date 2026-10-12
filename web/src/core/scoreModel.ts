import { isFoot, notationFor, type InstrumentId, type PedalRole } from './instruments'
import { computeBars, type BarInfo } from './timeline'
import type { DrumEvent, Timeline } from './types'

/**
 * Modelo de partitura independiente de la librería de renderizado.
 * Dos voces, como en la notación de batería habitual:
 *   voz 0 = manos (plicas arriba), voz 1 = pies (plicas abajo).
 * Cada voz rellena el compás completo con notas y silencios de duraciones
 * estándar. Los eventos deben venir ya cuantizados (ver quantize.ts).
 */

export interface ScoreNote {
  instrument: InstrumentId
  notation: number
  eventIds: string[]
  velocity: number
}

export interface ScoreBeat {
  startTick: number
  durationTicks: number
  /** 1 redonda, 2 blanca, 4 negra, 8 corchea, 16, 32 */
  duration: 1 | 2 | 4 | 8 | 16 | 32
  dotted: boolean
  /** 3 = tresillo, 6 = seisillo. */
  tuplet?: 3 | 6
  notes: ScoreNote[]
}

export interface ScoreBar {
  index: number
  info: BarInfo
  bpm?: number
  timeSigChanged: boolean
  voices: [ScoreBeat[], ScoreBeat[]]
}

export interface ScoreModel {
  ppq: number
  bars: ScoreBar[]
  /** Eventos que no encajaban en ninguna rejilla soportada (no debería ocurrir tras cuantizar). */
  warnings: string[]
}

const BASE: { d: ScoreBeat['duration']; dotted: boolean; mult: number }[] = [
  { d: 1, dotted: false, mult: 4 },
  { d: 2, dotted: true, mult: 3 },
  { d: 2, dotted: false, mult: 2 },
  { d: 4, dotted: true, mult: 1.5 },
  { d: 4, dotted: false, mult: 1 },
  { d: 8, dotted: true, mult: 0.75 },
  { d: 8, dotted: false, mult: 0.5 },
  { d: 16, dotted: true, mult: 0.375 },
  { d: 16, dotted: false, mult: 0.25 },
  { d: 32, dotted: false, mult: 0.125 },
]

/**
 * Descompone [start, end) (relativo al compás) en duraciones válidas sin cruzar
 * el pulso de forma ilegible: las figuras >= pulso solo empiezan en pulso y
 * múltiplos de su longitud; las < pulso no cruzan el pulso.
 */
function decompose(start: number, end: number, ppq: number, beatTicks: number, compound: boolean): { len: number; d: ScoreBeat['duration']; dotted: boolean }[] {
  const out: { len: number; d: ScoreBeat['duration']; dotted: boolean }[] = []
  let p = start
  let guard = 0
  while (p < end && guard++ < 256) {
    let chosen: { len: number; d: ScoreBeat['duration']; dotted: boolean } | null = null
    for (const b of BASE) {
      const len = Math.round(b.mult * ppq)
      if (len > end - p) continue
      if (b.dotted && len >= beatTicks && !compound && len !== beatTicks * 3) continue
      if (len >= beatTicks) {
        if (p % beatTicks !== 0) continue
        if (len % beatTicks !== 0) continue
        if (!compound && (p / beatTicks) % (len / beatTicks) !== 0 && !(len === beatTicks * 3 && p === 0)) continue
      } else {
        const beatIdx = Math.floor(p / beatTicks)
        if (Math.floor((p + len - 1) / beatTicks) !== beatIdx) continue
        // Figuras con puntillo dentro del pulso: solo si empiezan en una posición "limpia".
        if (b.dotted && (p % Math.round(0.25 * ppq)) !== 0) continue
      }
      chosen = { len, d: b.d, dotted: b.dotted }
      break
    }
    if (!chosen) {
      // Resto no representable (por cuantización incompleta): usar la fusa más cercana.
      const len = Math.max(1, Math.min(end - p, Math.round(ppq / 8)))
      chosen = { len, d: 32, dotted: false }
    }
    out.push(chosen)
    p += chosen.len
  }
  return out
}

/** Tipo de agrupación ternaria de un pulso de negra según las posiciones de sus golpes. */
function ternaryKind(rels: number[], ppq: number): 3 | 6 | null {
  if (rels.every((r) => r % (ppq / 8) === 0)) return null
  if (rels.every((r) => r % (ppq / 3) === 0)) return 3
  if (rels.every((r) => r % (ppq / 6) === 0)) return 6
  return null
}

function buildVoice(events: DrumEvent[], bar: BarInfo, ppq: number, pedalRole: PedalRole): ScoreBeat[] {
  const beats: ScoreBeat[] = []
  const len = bar.endTick - bar.startTick
  const byTick = new Map<number, DrumEvent[]>()
  for (const e of events) {
    const rel = e.tick - bar.startTick
    if (rel < 0 || rel >= len) continue
    const arr = byTick.get(rel)
    if (arr) arr.push(e)
    else byTick.set(rel, [e])
  }
  const onsets = [...byTick.keys()].sort((a, b) => a - b)
  const quarterBased = bar.den <= 4
  const compound = bar.den === 8 && bar.num % 3 === 0 && bar.num > 3

  // Pulsos ternarios: los que contienen algún golpe en posición de tresillo/seisillo.
  const ternaryBeats = new Map<number, 3 | 6>()
  if (quarterBased) {
    const perBeat = new Map<number, number[]>()
    for (const rel of onsets) {
      const beatIdx = Math.floor(rel / ppq)
      const arr = perBeat.get(beatIdx)
      if (arr) arr.push(rel - beatIdx * ppq)
      else perBeat.set(beatIdx, [rel - beatIdx * ppq])
    }
    for (const [beatIdx, rels] of perBeat) {
      const kind = ternaryKind(rels, ppq)
      if (kind) ternaryBeats.set(beatIdx, kind)
    }
  }

  const makeNotes = (evs: DrumEvent[]): ScoreNote[] => {
    const m = new Map<number, ScoreNote>()
    for (const e of evs) {
      const notation = notationFor(e.instrument, e.articulation, pedalRole)
      const n = m.get(notation)
      if (n) {
        n.eventIds.push(e.id)
        n.velocity = Math.max(n.velocity, e.velocity)
      } else m.set(notation, { instrument: e.instrument, notation, eventIds: [e.id], velocity: e.velocity })
    }
    return [...m.values()]
  }

  // Recorre el compás por tramos: binarios (descomposición estándar) o pulsos ternarios (unidad fija).
  let p = 0
  while (p < len) {
    const beatIdx = Math.floor(p / ppq)
    const tern = quarterBased ? ternaryBeats.get(beatIdx) : undefined
    if (tern && p === beatIdx * ppq) {
      const unit = ppq / tern
      for (let k = 0; k < tern; k++) {
        const rel = p + k * unit
        const evs = byTick.get(rel)
        beats.push({
          startTick: bar.startTick + rel,
          durationTicks: unit,
          duration: tern === 3 ? 8 : 16,
          dotted: false,
          tuplet: tern,
          notes: evs ? makeNotes(evs) : [],
        })
      }
      p += ppq
      continue
    }
    // Tramo binario: hasta el siguiente onset o el siguiente pulso ternario.
    let segEnd = len
    for (const o of onsets) if (o > p) { segEnd = o; break }
    for (const [bIdx] of ternaryBeats) {
      const s = bIdx * ppq
      if (s > p && s < segEnd) segEnd = s
    }
    const evs = byTick.get(p)
    const parts = decompose(p, segEnd, ppq, bar.beatTicks, compound)
    let q = p
    parts.forEach((part, i) => {
      beats.push({
        startTick: bar.startTick + q,
        durationTicks: part.len,
        duration: part.d,
        dotted: part.dotted,
        notes: i === 0 && evs ? makeNotes(evs) : [],
      })
      q += part.len
    })
    p = segEnd
  }
  return beats
}

export function buildScoreModel(tl: Timeline, events: DrumEvent[], durationTicks: number, pedalRole: PedalRole = 'hiHatPedal'): ScoreModel {
  const maxTick = Math.max(durationTicks - 1, ...events.map((e) => e.tick), 0)
  const bars = computeBars(tl, maxTick)
  const hands = events.filter((e) => !isFoot(e.instrument))
  const feet = events.filter((e) => isFoot(e.instrument))
  const warnings: string[] = []
  const tempos = [...tl.tempos].sort((a, b) => a.tick - b.tick)
  const out: ScoreBar[] = bars.map((info, i) => {
    const prev = bars[i - 1]
    const tempoHere = tempos.filter((t) => t.tick >= info.startTick && t.tick < info.endTick && (t.tick > 0 || i === 0))
    return {
      index: i,
      info,
      bpm: tempoHere.length ? tempoHere[0].bpm : undefined,
      timeSigChanged: !prev || prev.num !== info.num || prev.den !== info.den,
      voices: [buildVoice(hands, info, tl.ppq, pedalRole), buildVoice(feet, info, tl.ppq, pedalRole)],
    }
  })
  return { ppq: tl.ppq, bars: out, warnings }
}

/** Índice de nota de partitura → evento, para resaltar y editar desde la partitura. */
export function scoreBeatAt(model: ScoreModel, voice: 0 | 1, tick: number): { bar: number; index: number; beat: ScoreBeat } | null {
  for (const bar of model.bars) {
    if (tick < bar.info.startTick || tick >= bar.info.endTick) continue
    const beats = bar.voices[voice]
    for (let i = beats.length - 1; i >= 0; i--) if (beats[i].startTick <= tick) return { bar: bar.index, index: i, beat: beats[i] }
  }
  return null
}
