import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { autoAlign } from './alignment'
import { GM_MAPPING } from './midiMapping'
import { midiToEvents, parseMidi } from './midiIO'

/** Lector mínimo de WAV PCM 16 bits (las muestras generadas por scripts/generate-samples.ts). */
function readWav(path: URL): { mono: Float32Array; sampleRate: number } {
  const b = readFileSync(path)
  const channels = b.readUInt16LE(22)
  const sampleRate = b.readUInt32LE(24)
  let o = 12
  while (b.toString('ascii', o, o + 4) !== 'data') o += 8 + b.readUInt32LE(o + 4)
  const len = b.readUInt32LE(o + 4) / 2 / channels
  const mono = new Float32Array(len)
  for (let i = 0; i < len; i++) {
    let s = 0
    for (let c = 0; c < channels; c++) s += b.readInt16LE(o + 8 + (i * channels + c) * 2)
    mono[i] = s / channels / 32768
  }
  return { mono, sampleRate }
}

describe('alineación automática audio ↔ MIDI', () => {
  it('encuentra el desfase de 1,5 s de la muestra (±5 ms)', () => {
    const parsed = parseMidi(new Uint8Array(readFileSync(new URL('../../public/samples/funk-groove.mid', import.meta.url))), 'funk.mid')
    const { events } = midiToEvents(parsed, [0], GM_MAPPING)
    const { mono, sampleRate } = readWav(new URL('../../public/samples/funk-groove-audio.wav', import.meta.url))
    const r = autoAlign(mono, sampleRate, events, [-5, 10])
    expect(Math.abs(r.offset - 1.5)).toBeLessThan(0.005)
    expect(r.confidence).toBeGreaterThan(0.3)
  })

  it('con el audio de la demo (sin desfase) devuelve ~0', () => {
    // La demo mezcla batería y bajo: comprueba que el bajo no desvía el resultado.
    const parsed = parseMidi(new Uint8Array(readFileSync(new URL('../../public/samples/primer-groove.mid', import.meta.url))), 'demo.mid')
    const { events } = midiToEvents(parsed, [0], GM_MAPPING)
    const { mono, sampleRate } = readWav(new URL('../../public/samples/primer-groove-mix.wav', import.meta.url))
    const r = autoAlign(mono, sampleRate, events, [-5, 10])
    expect(Math.abs(r.offset)).toBeLessThan(0.005)
  })
})
