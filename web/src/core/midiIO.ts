import { Midi } from './toneMidi'
import { INSTRUMENTS, PEDAL_ROLES, type PedalRole } from './instruments'
import { mapNote, type DrumMapping } from './midiMapping'
import { DEFAULT_QUANTIZE, quantizeEvents, type QuantizeOptions } from './quantize'
import { annotateEvents, PPQ } from './timeline'
import type { DrumEvent, IgnoredHit, Timeline } from './types'
import { uid } from './uid'

export interface MidiTrackSummary {
  index: number
  name: string
  channel: number
  noteCount: number
  isPercussion: boolean
  /** nota → número de apariciones */
  notes: Record<number, number>
}

export interface ParsedMidi {
  midi: Midi
  name: string
  tracks: MidiTrackSummary[]
  timeline: Timeline
  durationSec: number
}

export function parseMidi(data: ArrayBuffer | Uint8Array, fileName = 'MIDI'): ParsedMidi {
  const midi = new Midi(data)
  const scale = PPQ / midi.header.ppq
  const tempos = midi.header.tempos.map((t) => ({ tick: Math.round(t.ticks * scale), bpm: t.bpm }))
  if (tempos.length === 0 || tempos[0].tick > 0) tempos.unshift({ tick: 0, bpm: tempos[0]?.bpm ?? 120 })
  const timeSigs = midi.header.timeSignatures.map((ts) => ({
    tick: Math.round(ts.ticks * scale),
    num: ts.timeSignature[0],
    den: ts.timeSignature[1],
  }))
  if (timeSigs.length === 0 || timeSigs[0].tick > 0) timeSigs.unshift({ tick: 0, num: 4, den: 4 })
  const tracks: MidiTrackSummary[] = midi.tracks.map((t, index) => {
    const notes: Record<number, number> = {}
    for (const n of t.notes) notes[n.midi] = (notes[n.midi] ?? 0) + 1
    return {
      index,
      name: t.name || t.instrument.name || `Pista ${index + 1}`,
      channel: t.channel,
      noteCount: t.notes.length,
      isPercussion: t.channel === 9 || t.instrument.percussion || /drum|bater|perc|kit/i.test(t.name),
      notes,
    }
  })
  return {
    midi,
    name: midi.header.name || fileName.replace(/\.(mid|midi)$/i, ''),
    tracks,
    timeline: { ppq: PPQ, tempos: dedupeByTick(tempos), timeSigs: dedupeByTick(timeSigs) },
    durationSec: midi.duration,
  }
}

function dedupeByTick<T extends { tick: number }>(arr: T[]): T[] {
  const map = new Map<number, T>()
  for (const x of arr) map.set(x.tick, x)
  return [...map.values()].sort((a, b) => a.tick - b.tick)
}

/** Notas de percusión distintas presentes en las pistas elegidas. */
export function collectNotes(parsed: ParsedMidi, trackIdx: number[]): Record<number, number> {
  const out: Record<number, number> = {}
  for (const i of trackIdx) for (const [n, c] of Object.entries(parsed.tracks[i].notes)) out[Number(n)] = (out[Number(n)] ?? 0) + c
  return out
}

export function midiToEvents(
  parsed: ParsedMidi,
  trackIdx: number[],
  mapping: DrumMapping,
  quantize: QuantizeOptions = DEFAULT_QUANTIZE,
): { events: DrumEvent[]; unmapped: number[]; ignored: IgnoredHit[] } {
  const scale = PPQ / parsed.midi.header.ppq
  const raw: DrumEvent[] = []
  const unmapped = new Set<number>()
  const ignored: IgnoredHit[] = []
  for (const i of trackIdx) {
    for (const n of parsed.midi.tracks[i].notes) {
      const mapped = mapNote(mapping, n.midi)
      const rawTick = n.ticks * scale
      if (!mapped) {
        unmapped.add(n.midi)
        ignored.push({ id: uid(), midiNote: n.midi, time: n.time, tick: Math.round(rawTick), rawTick, velocity: Math.max(1, Math.min(127, Math.round(n.velocity * 127))) })
        continue
      }
      raw.push({
        id: uid(),
        instrument: mapped.instrument,
        articulation: mapped.articulation,
        time: n.time,
        tick: Math.round(rawTick),
        rawTick,
        velocity: Math.max(1, Math.min(127, Math.round(n.velocity * 127))),
        bar: 0,
        beat: 0,
        subdivision: 0,
        source: 'midi',
        midiNote: n.midi,
      })
    }
  }
  const { events } = quantizeEvents(parsed.timeline, raw, quantize)
  return { events: annotateEvents(parsed.timeline, events), unmapped: [...unmapped].sort((a, b) => a - b), ignored }
}

/** Exporta a MIDI tipo 1 en el canal 10 (índice 9), con el mapa de tempo y compases. */
export function eventsToMidi(timeline: Timeline, events: DrumEvent[], title: string, pedalRole: PedalRole = 'hiHatPedal', useQuantized = true): Uint8Array {
  const midi = new Midi()
  // La cabecera de @tonejs/midi usa PPQ 480 fijo: se escalan los ticks.
  const scale = midi.header.ppq / timeline.ppq
  midi.header.tempos = timeline.tempos.map((t) => ({ ticks: Math.round(t.tick * scale), bpm: t.bpm }))
  midi.header.timeSignatures = timeline.timeSigs.map((ts) => ({ ticks: Math.round(ts.tick * scale), timeSignature: [ts.num, ts.den] }))
  midi.header.name = title
  midi.header.update()
  const track = midi.addTrack()
  track.name = 'Drums'
  track.channel = 9
  const shortTicks = midi.header.ppq / 8
  for (const e of events) {
    let note = e.midiNote ?? INSTRUMENTS[e.instrument].gmNote
    if (e.instrument === 'pedal' && e.midiNote === undefined) note = PEDAL_ROLES[pedalRole].gmNote
    if (e.midiNote === undefined && e.articulation) {
      const art: Record<string, number> = { 'hiHat:open': 46, 'ride:bell': 53, 'snare:sidestick': 37, 'crash:china': 52, 'crash:splash': 55 }
      note = art[`${e.instrument}:${e.articulation}`] ?? note
    }
    const startTicks = Math.round((useQuantized ? e.tick : (e.rawTick ?? e.tick)) * scale)
    track.addNote({ midi: note, ticks: startTicks, durationTicks: shortTicks, velocity: e.velocity / 127 })
  }
  return midi.toArray()
}
