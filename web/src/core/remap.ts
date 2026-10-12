import type { MappedNote } from './midiMapping'
import { quantizeEvents } from './quantize'
import { annotateEvents } from './timeline'
import type { DrumEvent, IgnoredHit, Timeline } from './types'

/**
 * Reasignación de notas MIDI → piezas DESPUÉS de importar.
 * Cada golpe guarda su nota MIDI original (`midiNote`), así que cambiar la
 * pieza de una nota afecta a todos sus golpes a la vez. Las notas que se
 * ignoraron al importar se guardan como `ignoredHits` y pueden recuperarse.
 */

export interface NoteSummary {
  note: number
  /** Golpes en la canción (asignados) + ignorados. */
  count: number
  ignored: number
  /** Asignación actual (la más frecuente entre sus golpes) o null si está ignorada. */
  current: MappedNote | null
  /** Asignación mixta: algunos golpes de esta nota se cambiaron a mano a otra pieza. */
  mixed: boolean
  firstTime: number
}

const keyOf = (m: MappedNote | null) => (m ? `${m.instrument}:${m.articulation ?? ''}` : '')

export function summarizeNotes(events: DrumEvent[], ignored: IgnoredHit[] = []): NoteSummary[] {
  const by = new Map<number, { counts: Map<string, { m: MappedNote; n: number }>; ignored: number; first: number }>()
  const get = (note: number) => {
    let x = by.get(note)
    if (!x) by.set(note, (x = { counts: new Map(), ignored: 0, first: Infinity }))
    return x
  }
  for (const e of events) {
    if (e.midiNote === undefined) continue
    const x = get(e.midiNote)
    const m: MappedNote = { instrument: e.instrument, articulation: e.articulation }
    const k = keyOf(m)
    const c = x.counts.get(k)
    if (c) c.n++
    else x.counts.set(k, { m, n: 1 })
    x.first = Math.min(x.first, e.time)
  }
  for (const h of ignored) {
    const x = get(h.midiNote)
    x.ignored++
    x.first = Math.min(x.first, h.time)
  }
  return [...by.entries()]
    .map(([note, x]) => {
      const sorted = [...x.counts.values()].sort((a, b) => b.n - a.n)
      const assigned = sorted.reduce((s, c) => s + c.n, 0)
      return {
        note,
        count: assigned + x.ignored,
        ignored: x.ignored,
        current: assigned >= x.ignored && sorted[0] ? sorted[0].m : null,
        mixed: sorted.length > 1 || (assigned > 0 && x.ignored > 0),
        firstTime: x.first,
      }
    })
    .sort((a, b) => a.note - b.note)
}

/** Aplica nuevas asignaciones por nota. Devuelve listas nuevas (no modifica las de entrada). */
export function remapNotes(
  tl: Timeline,
  events: DrumEvent[],
  ignored: IgnoredHit[],
  changes: Map<number, MappedNote | null>,
): { events: DrumEvent[]; ignored: IgnoredHit[] } {
  const outEvents: DrumEvent[] = []
  const outIgnored: IgnoredHit[] = []
  for (const e of events) {
    if (e.midiNote === undefined || !changes.has(e.midiNote)) {
      outEvents.push(e)
      continue
    }
    const m = changes.get(e.midiNote)!
    if (m === null) outIgnored.push({ id: e.id, midiNote: e.midiNote, time: e.time, tick: e.tick, rawTick: e.rawTick, velocity: e.velocity })
    else outEvents.push({ ...e, instrument: m.instrument, articulation: m.articulation })
  }
  const revived: DrumEvent[] = []
  for (const h of ignored) {
    const m = changes.get(h.midiNote)
    if (m === undefined || m === null) {
      outIgnored.push(h)
      continue
    }
    revived.push({
      id: h.id,
      instrument: m.instrument,
      articulation: m.articulation,
      time: h.time,
      tick: h.tick,
      rawTick: h.rawTick ?? h.tick,
      velocity: h.velocity,
      bar: 0,
      beat: 0,
      subdivision: 0,
      source: 'midi',
      midiNote: h.midiNote,
    })
  }
  // Los golpes recuperados se cuantizan con la misma rejilla que el resto.
  const quantized = revived.length ? quantizeEvents(tl, revived).events : []
  return {
    events: annotateEvents(tl, [...outEvents, ...quantized].sort((a, b) => a.tick - b.tick || a.time - b.time)),
    ignored: outIgnored,
  }
}
