import { DEMO_CHORDS } from '../core/demoSong'
import { computeBars } from '../core/timeline'
import type { Song } from '../core/types'
import { playDrum } from './drumSynth'

/**
 * Renderiza los stems de la demo (batería y acompañamiento) con un
 * OfflineAudioContext a partir de los mismos eventos que ve el usuario.
 */

const SR = 44100

const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12)

export async function renderDemoDrums(song: Song): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.ceil(song.duration * SR), SR)
  const bus = ctx.createGain()
  bus.gain.value = 0.8
  bus.connect(ctx.destination)
  for (const e of song.events) playDrum(ctx, bus, e.instrument, e.time, e.velocity, e.articulation, song.pedalRole)
  return ctx.startRendering()
}

export async function renderDemoBacking(song: Song): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.ceil(song.duration * SR), SR)
  const master = ctx.createDynamicsCompressor()
  master.connect(ctx.destination)
  const bars = computeBars(song.timeline, song.events.reduce((m, e) => Math.max(m, e.tick), 0))
  const lastBar = bars.length - 1
  bars.forEach((bar, i) => {
    const chord = DEMO_CHORDS[i % DEMO_CHORDS.length]
    const final = i === lastBar
    const end = final ? bar.startTime + 1.6 : bar.endTime
    // Pad: tríada con triángulo suave.
    const third = chord.minor ? 3 : 4
    for (const iv of [12, 12 + third, 19]) {
      const o = ctx.createOscillator()
      o.type = 'triangle'
      o.frequency.value = midiToHz(chord.root + iv)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, bar.startTime)
      g.gain.linearRampToValueAtTime(0.05, bar.startTime + 0.08)
      g.gain.setValueAtTime(0.05, end - 0.1)
      g.gain.linearRampToValueAtTime(0.0001, end)
      o.connect(g).connect(master)
      o.start(bar.startTime)
      o.stop(end + 0.02)
    }
    // Bajo en corcheas siguiendo la raíz (y la quinta en la segunda mitad).
    const eighth = (bar.endTime - bar.startTime) / 8
    const notes = final ? [0] : [0, 1, 2, 3, 4, 5, 6, 7]
    for (const k of notes) {
      const t = bar.startTime + k * eighth
      const midi = chord.root - 12 + (k >= 6 ? 7 : 0)
      const o = ctx.createOscillator()
      o.type = 'sawtooth'
      o.frequency.value = midiToHz(midi)
      const f = ctx.createBiquadFilter()
      f.type = 'lowpass'
      f.frequency.setValueAtTime(900, t)
      f.frequency.exponentialRampToValueAtTime(250, t + eighth * 0.9)
      const g = ctx.createGain()
      const len = final ? 1.4 : eighth * 0.9
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(k % 2 === 0 ? 0.32 : 0.24, t + 0.008)
      g.gain.exponentialRampToValueAtTime(0.0001, t + len)
      o.connect(f).connect(g).connect(master)
      o.start(t)
      o.stop(t + len + 0.02)
    }
  })
  return ctx.startRendering()
}
