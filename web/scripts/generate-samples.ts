/**
 * Genera archivos de muestra en public/samples/ (npm run gen:samples):
 *  - funk-groove.mid            MIDI nuevo, humanizado (±12 ms), con notas fuera del mapa GM básico.
 *  - funk-groove-audio.wav      Audio sintetizado del mismo groove + bajo, con 1,5 s de silencio inicial
 *                               (para probar "audio + partitura" y el ajuste de offset).
 *  - primer-groove.mid / .musicxml   La demo exportada (para probar importación MusicXML).
 *  - primer-groove-mix.wav      Mezcla completa de la demo (para probar la transcripción automática).
 *
 * Usa node-web-audio-api (OfflineAudioContext en Node) y el mismo sintetizador que la app.
 */
import { Midi } from '../src/core/toneMidi'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { OfflineAudioContext } from 'node-web-audio-api'
import { playDrum } from '../src/audio/drumSynth'
import { createDemoSong } from '../src/core/demoSong'
import { mapNote, GM_MAPPING } from '../src/core/midiMapping'
import { eventsToMidi } from '../src/core/midiIO'
import { scoreToMusicXml } from '../src/core/musicXml'
import { buildScoreModel } from '../src/core/scoreModel'
import { secondsToTick } from '../src/core/timeline'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'samples')
mkdirSync(OUT, { recursive: true })
const SR = 44100

function rng(seed: number) {
  let s = seed
  return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
}

function wav(channels: Float32Array[], sr: number): Buffer {
  const n = channels[0].length
  const c = channels.length
  const buf = Buffer.alloc(44 + n * c * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + n * c * 2, 4)
  buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(c, 22)
  buf.writeUInt32LE(sr, 24)
  buf.writeUInt32LE(sr * c * 2, 28)
  buf.writeUInt16LE(c * 2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(n * c * 2, 40)
  let o = 44
  for (let i = 0; i < n; i++)
    for (let ch = 0; ch < c; ch++) {
      const v = Math.max(-1, Math.min(1, channels[ch][i]))
      buf.writeInt16LE(Math.round(v < 0 ? v * 0x8000 : v * 0x7fff), o)
      o += 2
    }
  return buf
}

// ---------- 1. Funk groove MIDI ----------
const BPM = 96
const bars = 8
const midi = new Midi()
midi.header.setTempo(BPM)
midi.header.timeSignatures.push({ ticks: 0, timeSignature: [4, 4] })
midi.header.name = 'Funk Groove (muestra)'
midi.header.update()
const track = midi.addTrack()
track.name = 'Drums'
track.channel = 9
const ppq = midi.header.ppq
const r = rng(7)
const human = () => Math.round((r() - 0.5) * 2 * (0.012 * (BPM / 60) * ppq)) // ±12 ms en ticks
const sixteenth = ppq / 4
type Hit = [number, number, number] // [semicorchea 0-15, nota, velocity]
const pattern = (bar: number): Hit[] => {
  const hits: Hit[] = []
  for (let i = 0; i < 16; i++) hits.push([i, i === 14 && bar % 2 === 1 ? 46 : 42, i % 4 === 0 ? 100 : i % 2 === 0 ? 80 : 55])
  hits.push([4, 38, 110], [12, 38, 110], [7, 38, 32], [9, 38, 30])
  hits.push([0, 36, 115], [3, 36, 90], [10, 36, 100])
  if (bar % 4 === 3) {
    hits.push([12, 48, 100], [13, 48, 95], [14, 45, 100], [15, 43, 105])
    hits.push([12, 39, 70]) // palmas (GM 39 → caja)
  }
  if (bar === 0 || bar === 4) hits.push([0, 49, 120])
  hits.push([6, 54, 60]) // pandereta (GM 54, sin pieza → aparece como "sin asignar")
  return hits
}
for (let b = 0; b < bars; b++)
  for (const [pos, note, vel] of pattern(b)) {
    const ticks = Math.max(0, b * ppq * 4 + pos * sixteenth + (pos === 0 && b === 0 ? 0 : human()))
    track.addNote({ midi: note, ticks, durationTicks: sixteenth / 2, velocity: vel / 127 })
  }
track.addNote({ midi: 49, ticks: bars * ppq * 4, durationTicks: sixteenth, velocity: 1 })
track.addNote({ midi: 36, ticks: bars * ppq * 4, durationTicks: sixteenth, velocity: 0.9 })
writeFileSync(join(OUT, 'funk-groove.mid'), Buffer.from(midi.toArray()))

// ---------- 2. Audio del funk con 1,5 s de silencio ----------
const LEAD = 1.5
const total = LEAD + (bars + 1) * 4 * (60 / BPM) + 1.5
{
  const ctx = new OfflineAudioContext(1, Math.ceil(total * SR), SR) as unknown as BaseAudioContext & { startRendering(): Promise<AudioBuffer> }
  const bus = ctx.createGain()
  bus.gain.value = 0.7
  bus.connect(ctx.destination)
  for (const n of track.notes) {
    const m = mapNote(GM_MAPPING, n.midi)
    if (m) playDrum(ctx, bus, m.instrument, LEAD + n.time, n.velocity * 127, m.articulation)
  }
  // Bajo sencillo en semicorcheas sincopadas (Mi menor).
  const beat = 60 / BPM
  for (let b = 0; b < bars; b++)
    for (const [pos, semis] of [[0, 0], [3, 0], [6, 3], [10, 5], [11, 7]] as const) {
      const t = LEAD + b * 4 * beat + pos * (beat / 4)
      const o = ctx.createOscillator()
      o.type = 'sawtooth'
      o.frequency.value = 41.2 * Math.pow(2, semis / 12) * 2
      const f = ctx.createBiquadFilter()
      f.type = 'lowpass'
      f.frequency.value = 600
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.3, t + 0.01)
      g.gain.exponentialRampToValueAtTime(0.0001, t + beat * 0.45)
      o.connect(f).connect(g).connect(ctx.destination)
      o.start(t)
      o.stop(t + beat * 0.5)
    }
  const buf = await ctx.startRendering()
  writeFileSync(join(OUT, 'funk-groove-audio.wav'), wav([buf.getChannelData(0)], SR))
}

// ---------- 3. Demo exportada ----------
const demo = createDemoSong()
writeFileSync(join(OUT, 'primer-groove.mid'), Buffer.from(eventsToMidi(demo.timeline, demo.events, demo.title)))
const model = buildScoreModel(demo.timeline, demo.events, secondsToTick(demo.timeline, demo.duration))
writeFileSync(join(OUT, 'primer-groove.musicxml'), scoreToMusicXml(model, demo.title, demo.artist))
{
  const { renderDemoDrums, renderDemoBacking } = await import('../src/audio/renderDemo')
  const g = globalThis as unknown as { OfflineAudioContext: unknown }
  g.OfflineAudioContext = OfflineAudioContext
  const [d, bk] = await Promise.all([renderDemoDrums(demo), renderDemoBacking(demo)])
  const mono = new Float32Array(d.length)
  const dd = d.getChannelData(0)
  const bb = bk.getChannelData(0)
  for (let i = 0; i < mono.length; i++) mono[i] = 0.85 * dd[i] + 0.85 * bb[i]
  writeFileSync(join(OUT, 'primer-groove-mix.wav'), wav([mono], SR))
  // Solo batería (equivale a una separación perfecta): para evaluar el clasificador por separado.
  writeFileSync(join(OUT, 'primer-groove-drums.wav'), wav([dd], SR))
  // Referencia de golpes para medir la transcripción (tiempo, pieza).
  writeFileSync(join(OUT, 'primer-groove-reference.json'), JSON.stringify(demo.events.map((e) => ({ time: +e.time.toFixed(4), instrument: e.instrument })), null, 0))
}
console.log('Muestras generadas en', OUT)
