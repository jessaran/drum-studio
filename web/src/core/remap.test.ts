import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { GM_MAPPING } from './midiMapping'
import { midiToEvents, parseMidi } from './midiIO'
import { remapNotes, summarizeNotes } from './remap'

const parsed = parseMidi(new Uint8Array(readFileSync(new URL('../../public/samples/funk-groove.mid', import.meta.url))), 'funk.mid')
const { events, ignored } = midiToEvents(parsed, [0], GM_MAPPING)

describe('reasignar notas después de importar', () => {
  it('guarda los golpes de notas sin asignar y los resume', () => {
    expect(ignored.length).toBeGreaterThan(0)
    expect(ignored.every((h) => h.midiNote === 54)).toBe(true)
    const s = summarizeNotes(events, ignored)
    const n54 = s.find((x) => x.note === 54)!
    expect(n54.current).toBeNull()
    expect(n54.ignored).toBe(ignored.length)
    expect(s.find((x) => x.note === 38)!.current).toEqual({ instrument: 'snare', articulation: undefined })
  })

  it('cambia la pieza de todos los golpes de una nota', () => {
    const r = remapNotes(parsed.timeline, events, ignored, new Map([[39, { instrument: 'tom1' as const }]]))
    const n39 = r.events.filter((e) => e.midiNote === 39)
    expect(n39.length).toBeGreaterThan(0)
    expect(n39.every((e) => e.instrument === 'tom1')).toBe(true)
    expect(r.events.length).toBe(events.length)
  })

  it('recupera notas ignoradas y puede volver a ignorarlas sin perder golpes', () => {
    const a = remapNotes(parsed.timeline, events, ignored, new Map([[54, { instrument: 'ride' as const }]]))
    expect(a.ignored.length).toBe(0)
    expect(a.events.length).toBe(events.length + ignored.length)
    const rides = a.events.filter((e) => e.midiNote === 54)
    expect(rides.every((e) => e.instrument === 'ride' && e.tick % 240 === 0)).toBe(true)
    const b = remapNotes(parsed.timeline, a.events, a.ignored, new Map([[54, null]]))
    expect(b.events.length).toBe(events.length)
    expect(b.ignored.length).toBe(ignored.length)
  })
})
