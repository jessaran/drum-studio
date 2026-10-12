import type { InstrumentId } from '../../core/instruments'
import { tickToSeconds } from '../../core/timeline'
import type { DrumEvent, Timeline } from '../../core/types'
import { uid } from '../../core/uid'

/**
 * Operaciones puras del editor. Todas devuelven una lista NUEVA de eventos
 * (la misma que usa el reproductor), marcando los golpes tocados como `manual`.
 */

const markManual = (e: DrumEvent): DrumEvent => (e.source === 'manual' ? e : { ...e, source: 'manual', originalSource: e.originalSource ?? e.source, confidence: undefined })

/** Desfase de interpretación respecto a la rejilla (se conserva al mover). */
const humanOffset = (tl: Timeline, e: DrumEvent) => e.time - tickToSeconds(tl, e.tick)

export function addHit(tl: Timeline, events: DrumEvent[], instrument: InstrumentId, tick: number, velocity = 100): { events: DrumEvent[]; id: string } {
  const existing = events.find((e) => e.instrument === instrument && e.tick === tick)
  if (existing) return { events, id: existing.id }
  const id = uid()
  return {
    id,
    events: [...events, { id, instrument, tick, rawTick: tick, time: tickToSeconds(tl, tick), velocity, bar: 0, beat: 0, subdivision: 0, source: 'manual' }],
  }
}

export function removeHits(events: DrumEvent[], ids: Set<string>): DrumEvent[] {
  return events.filter((e) => !ids.has(e.id))
}

export function moveHits(tl: Timeline, events: DrumEvent[], ids: Set<string>, deltaTicks: number, newInstrument?: InstrumentId): DrumEvent[] {
  return events.map((e) => {
    if (!ids.has(e.id)) return e
    const tick = Math.max(0, e.tick + deltaTicks)
    const off = humanOffset(tl, e)
    const instrument = newInstrument ?? e.instrument
    return markManual({ ...e, tick, rawTick: tick, time: Math.max(0, tickToSeconds(tl, tick) + off), instrument, articulation: newInstrument && newInstrument !== e.instrument ? undefined : e.articulation, midiNote: newInstrument ? undefined : e.midiNote })
  })
}

export function setVelocity(events: DrumEvent[], ids: Set<string>, velocity: number): DrumEvent[] {
  return events.map((e) => (ids.has(e.id) ? markManual({ ...e, velocity }) : e))
}

export function setArticulation(events: DrumEvent[], ids: Set<string>, articulation: string | undefined): DrumEvent[] {
  return events.map((e) => (ids.has(e.id) ? markManual({ ...e, articulation, midiNote: undefined }) : e))
}

/** Recuantiza los golpes a la rejilla (en ticks) y, opcionalmente, ajusta su tiempo real a la rejilla. */
export function quantizeHits(tl: Timeline, events: DrumEvent[], ids: Set<string>, gridTicks: number, snapTime: boolean): DrumEvent[] {
  return events.map((e) => {
    if (!ids.has(e.id)) return e
    const base = e.rawTick ?? e.tick
    const tick = Math.max(0, Math.round(base / gridTicks) * gridTicks)
    const time = snapTime ? tickToSeconds(tl, tick) : tickToSeconds(tl, tick) + humanOffset(tl, e)
    return markManual({ ...e, tick, time })
  })
}
