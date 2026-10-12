import * as alphaTab from '@coderline/alphatab'
import { describe, expect, it } from 'vitest'
import { scoreToAlphaTex } from './alphaTex'
import { createDemoSong } from './demoSong'
import { eventsToMidi, midiToEvents, parseMidi } from './midiIO'
import { GM_MAPPING } from './midiMapping'
import { quantizeEvents } from './quantize'
import { buildScoreModel } from './scoreModel'
import { extractFromScore } from './scoreImport'
import { createTimeline, secondsToTick, tickToSeconds } from './timeline'
import type { DrumEvent } from './types'

function ev(instrument: DrumEvent['instrument'], tick: number, rawTick?: number): DrumEvent {
  return { id: `${instrument}${tick}`, instrument, tick, rawTick, time: 0, velocity: 100, bar: 0, beat: 0, subdivision: 0, source: 'midi' }
}

describe('timeline', () => {
  it('convierte ticks <-> segundos con cambios de tempo', () => {
    const tl = { ppq: 960, tempos: [{ tick: 0, bpm: 120 }, { tick: 3840, bpm: 60 }], timeSigs: [{ tick: 0, num: 4, den: 4 }] }
    expect(tickToSeconds(tl, 3840)).toBeCloseTo(2, 9)
    expect(tickToSeconds(tl, 4800)).toBeCloseTo(3, 9)
    expect(secondsToTick(tl, 3)).toBeCloseTo(4800, 6)
  })
})

describe('cuantización', () => {
  const tl = createTimeline(120)
  it('ajusta golpes humanizados a semicorcheas', () => {
    const raw = [0, 250, 470, 735, 955].map((t, i) => ev('hiHat', Math.round(t), t + (i % 2 ? 7 : -9)))
    const { events } = quantizeEvents(tl, raw)
    expect(events.map((e) => e.tick)).toEqual([0, 240, 480, 720, 960])
  })
  it('detecta tresillos de corchea', () => {
    const raw = [0, 318, 645].map((t) => ev('snare', t, t))
    const { events, grids } = quantizeEvents(tl, raw)
    expect(events.map((e) => e.tick)).toEqual([0, 320, 640])
    expect(grids[0].grid.id).toBe('t8')
  })
})

/** Articulación GP7 → nota MIDI de salida (solo difieren las variantes). */
const outputMidi = (n: number) => (n === 92 ? 46 : n === 91 ? 38 : n)

/** Carga alphaTex con alphaTab y devuelve (tick, articulaciones) de cada nota. */
function parseTex(tex: string) {
  const score = alphaTab.importer.ScoreLoader.loadAlphaTex(tex)
  const track = score.tracks[0]
  const notes: { tick: number; midi: number }[] = []
  const barLens: number[] = []
  for (const bar of track.staves[0].bars) {
    for (const v of bar.voices) {
      let sum = 0
      for (const b of v.beats) {
        sum += b.playbackDuration
        for (const n of b.notes) notes.push({ tick: b.absolutePlaybackStart, midi: track.percussionArticulations[n.percussionArticulation].outputMidiNumber })
      }
      barLens.push(sum)
    }
  }
  return { score, notes, barLens }
}

describe('partitura (modelo → alphaTex → alphaTab)', () => {
  const song = createDemoSong()
  const durationTicks = secondsToTick(song.timeline, song.duration)
  const model = buildScoreModel(song.timeline, song.events, durationTicks)
  const tex = scoreToAlphaTex(model, song.title, song.artist)

  it('alphaTab interpreta el alphaTex generado y cada voz completa su compás', () => {
    const { barLens, score } = parseTex(tex)
    expect(score.masterBars.length).toBe(model.bars.length)
    for (const len of barLens) expect(len).toBe(3840)
  })

  it('cada golpe aparece en la partitura en su tick exacto (incluidos tresillos)', () => {
    const { notes } = parseTex(tex)
    const key = (tick: number, n: number) => `${tick}:${n}`
    const fromScore = new Set(notes.map((n) => key(n.tick, n.midi)))
    for (const bar of model.bars)
      for (const v of bar.voices)
        for (const b of v) for (const n of b.notes) expect(fromScore.has(key(b.startTick, outputMidi(n.notation)))).toBe(true)
    // Recuento: cada evento se representa en exactamente una nota (eventos simultáneos del mismo instrumento se agrupan).
    const eventIds = model.bars.flatMap((b) => b.voices.flatMap((v) => v.flatMap((bt) => bt.notes.flatMap((n) => n.eventIds))))
    expect(new Set(eventIds).size).toBe(song.events.length)
  })

  it('ida y vuelta: alphaTex → extracción de eventos conserva ticks e instrumentos', () => {
    const { score } = parseTex(tex)
    const back = extractFromScore(score, 'demo', GM_MAPPING)
    const a = song.events.map((e) => `${e.tick}:${e.instrument}`).sort()
    const b = back.events.map((e) => `${e.tick}:${e.instrument}`).sort()
    expect(b).toEqual(a)
  })
})

describe('MIDI', () => {
  it('exportar e importar conserva los eventos', () => {
    const song = createDemoSong()
    const bytes = eventsToMidi(song.timeline, song.events, song.title)
    const parsed = parseMidi(bytes, 'demo.mid')
    expect(parsed.tracks[0].isPercussion).toBe(true)
    const { events, unmapped } = midiToEvents(parsed, [0], GM_MAPPING)
    expect(unmapped).toEqual([])
    // 'closed' es la articulación por defecto del hi-hat.
    const k = (e: DrumEvent) => `${e.tick}:${e.instrument}:${e.articulation === 'closed' ? '' : (e.articulation ?? '')}`
    const a = song.events.map(k).sort()
    const b = events.map(k).sort()
    expect(b).toEqual(a)
    for (const e of events) expect(Math.abs(e.time - tickToSeconds(song.timeline, e.tick))).toBeLessThan(1e-3)
  })
})

describe('MusicXML', () => {
  it('exporta y alphaTab lo reimporta con los mismos golpes (ticks e instrumentos)', async () => {
    const { scoreToMusicXml } = await import('./musicXml')
    const { importScoreBytes } = await import('./scoreImport')
    const song = createDemoSong()
    const model = buildScoreModel(song.timeline, song.events, secondsToTick(song.timeline, song.duration))
    const xml = scoreToMusicXml(model, song.title, song.artist)
    const back = importScoreBytes(new TextEncoder().encode(xml), 'demo.musicxml', GM_MAPPING)
    const k = (e: DrumEvent) => `${e.tick}:${e.instrument}`
    expect(back.events.map(k).sort()).toEqual(song.events.map(k).sort())
    expect(back.timeline.tempos[0].bpm).toBe(100)
  })
})

describe('MIDI de terceros (muestra humanizada)', () => {
  it('cuantiza a semicorcheas, conserva el tiempo real y reporta notas sin asignar', async () => {
    const { readFileSync } = await import('node:fs')
    const bytes = readFileSync(new URL('../../public/samples/funk-groove.mid', import.meta.url))
    const parsed = parseMidi(new Uint8Array(bytes), 'funk-groove.mid')
    const { events, unmapped } = midiToEvents(parsed, [0], GM_MAPPING)
    expect(unmapped).toEqual([54])
    expect(events.every((e) => e.tick % 240 === 0)).toBe(true)
    // El tiempo de interpretación conserva la humanización (no coincide exactamente con la rejilla).
    const offGrid = events.filter((e) => Math.abs(e.time - tickToSeconds(parsed.timeline, e.tick)) > 0.002)
    expect(offGrid.length).toBeGreaterThan(events.length / 2)
    expect(Math.max(...events.map((e) => Math.abs(e.time - tickToSeconds(parsed.timeline, e.tick))))).toBeLessThan(0.013)
    // Golpes simultáneos conservan su tick compartido (bombo + hi-hat en el 1).
    const first = events.filter((e) => e.tick === 0).map((e) => e.instrument).sort()
    expect(first).toEqual(['crash', 'hiHat', 'kick'])
  })
})
