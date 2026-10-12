import type { InstrumentId } from './instruments'
import { annotateEvents, computeBars, createTimeline, tickToSeconds } from './timeline'
import type { DrumEvent, Song } from './types'

/**
 * Canción de demostración original ("Primer Groove", 100 BPM, 16 compases).
 * Los golpes se definen sobre una rejilla exacta, así que audio, eventos y
 * partitura están perfectamente alineados: sirve como referencia para
 * comprobar la sincronización.
 *
 * Notación de patrones: una cadena por instrumento y compás.
 *   16 caracteres = semicorcheas, 12 = tresillos de corchea, 8 = corcheas, 4 = negras.
 *   x normal · X acento · g nota fantasma · o hi-hat abierto · b campana · . silencio
 */

export const DEMO_BPM = 100
export const DEMO_ID = 'demo-primer-groove'

/** Una o varias cadenas por instrumento (se combinan: útil para mezclar pulsos binarios y ternarios). */
type BarPattern = Partial<Record<InstrumentId, string | string[]>>

const GROOVE_A: BarPattern = {
  hiHat: 'x.x.x.x.x.x.x.x.',
  snare: '....x.......x...',
  kick: 'x.......x.x.....',
}

const GROOVE_B: BarPattern = {
  ride: 'x.x.b.x.x.x.b.x.',
  snare: '....x.......x...',
  kick: 'x..x..x...x.....',
  pedal: '....x.......x...',
}

const GROOVE_C: BarPattern = {
  hiHat: 'xxxxxxxxxxxxxxxo',
  snare: '..g.x..g..g.x...',
  kick: 'x.....x.x.......',
}

const FILL_16: BarPattern = {
  hiHat: 'x.x.x.x.........',
  snare: '....x...',
  kick: 'x.......x.......',
  tom1: '........xxxx....',
  tom2: '............xx..',
  floorTom: '..............xx',
}

/** Compás 12: dos pulsos binarios y dos pulsos de tresillos (comprueba la notación ternaria). */
const FILL_TRIPLET: BarPattern = {
  hiHat: 'x.x.x.x.........',
  snare: ['....x...........', '......xxx...'],
  kick: ['x...............', '.........x..'],
  tom1: '.........x..',
  tom2: '..........x.',
  floorTom: '...........x',
}

const ENDING: BarPattern = {
  crash: 'X...',
  kick: 'x...',
}

const withCrash = (p: BarPattern): BarPattern => ({ ...p, crash: 'X...............', hiHat: typeof p.hiHat === 'string' ? '.' + p.hiHat.slice(1) : p.hiHat })

const BARS: BarPattern[] = [
  withCrash(GROOVE_A), GROOVE_A, GROOVE_A, FILL_16,
  withCrash(GROOVE_B), GROOVE_B, GROOVE_B, FILL_16,
  withCrash(GROOVE_C), GROOVE_C, GROOVE_C, FILL_TRIPLET,
  withCrash(GROOVE_A), GROOVE_A, FILL_16, ENDING,
]

/** Variante para principiantes escrita a mano (no generada): mismo esqueleto, sin rellenos. */
const BEGINNER_A: BarPattern = { hiHat: 'x.x.x.x.', snare: '..x...x.', kick: 'x...x...' }
const BEGINNER_BARS: BarPattern[] = [
  { ...BEGINNER_A, crash: 'X...', hiHat: '..x.x.x.' }, BEGINNER_A, BEGINNER_A, BEGINNER_A,
  { ride: 'x.x.x.x.', snare: '..x...x.', kick: 'x...x...', crash: 'X...' }, { ride: 'x.x.x.x.', snare: '..x...x.', kick: 'x...x...' }, { ride: 'x.x.x.x.', snare: '..x...x.', kick: 'x...x...' }, { snare: '..x...x.', kick: 'x...x...', floorTom: '.....x.x' },
  { ...BEGINNER_A, crash: 'X...', hiHat: '..x.x.x.' }, BEGINNER_A, BEGINNER_A, { snare: '..x...x.', kick: 'x...x...', tom1: '....x...', tom2: '.....x..' },
  { ...BEGINNER_A, crash: 'X...', hiHat: '..x.x.x.' }, BEGINNER_A, BEGINNER_A, ENDING,
]

let seq = 0

function patternEvents(bars: BarPattern[], barTicks: number): Omit<DrumEvent, 'time'>[] {
  const out: Omit<DrumEvent, 'time'>[] = []
  bars.forEach((bar, bi) => {
    for (const [inst, value] of Object.entries(bar) as [InstrumentId, string | string[] | undefined][]) {
      if (!value) continue
      for (const str of Array.isArray(value) ? value : [value]) {
        const step = barTicks / str.length
        for (let i = 0; i < str.length; i++) {
          const c = str[i]
          if (c === '.') continue
          out.push({
            id: `demo${++seq}`,
            instrument: inst,
            tick: bi * barTicks + Math.round(i * step),
            velocity: c === 'X' ? 120 : c === 'g' ? 35 : c === 'b' ? 95 : 100,
            articulation: c === 'o' ? 'open' : c === 'b' ? 'bell' : undefined,
            bar: bi,
            beat: 0,
            subdivision: 0,
            source: 'demo',
          })
        }
      }
    }
  })
  return out
}

export function createDemoSong(): Song {
  const tl = createTimeline(DEMO_BPM, 4, 4)
  const barTicks = tl.ppq * 4
  const events = patternEvents(BARS, barTicks)
  const withTime = (evs: Omit<DrumEvent, 'time'>[]): DrumEvent[] =>
    annotateEvents(tl, evs.map((e) => ({ ...e, time: tickToSeconds(tl, e.tick) })).sort((a, b) => a.tick - b.tick))
  const durationTicks = BARS.length * barTicks
  const bars = computeBars(tl, durationTicks - 1)
  const now = Date.now()
  return {
    id: DEMO_ID,
    title: 'Primer Groove',
    artist: 'DrumStudio (demo)',
    origin: 'demo',
    timeline: tl,
    events: withTime(events),
    duration: bars[bars.length - 1].endTime + 1.5,
    sections: [
      { id: 's1', name: 'Groove A (hi-hat)', startBar: 0, endBar: 4 },
      { id: 's2', name: 'Groove B (ride)', startBar: 4, endBar: 8 },
      { id: 's3', name: 'Groove C (16 + fantasmas)', startBar: 8, endBar: 12 },
      { id: 's4', name: 'Final', startBar: 12, endBar: 16 },
    ],
    pedalRole: 'hiHatPedal',
    levels: { beginner: withTime(patternEvents(BEGINNER_BARS, barTicks).map((e) => ({ ...e, id: 'b' + e.id }))) },
    audio: {
      offset: 0,
      stems: [
        { id: 'drums', name: 'Batería', kind: 'drums', blobKey: 'generated:demo-drums' },
        { id: 'backing', name: 'Acompañamiento', kind: 'backing', blobKey: 'generated:demo-backing' },
      ],
    },
    createdAt: now,
    updatedAt: now,
    notes: 'Canción original de demostración. El audio se sintetiza en el navegador a partir de los mismos eventos, por lo que la alineación es exacta.',
  }
}

/** Progresión del acompañamiento (un acorde por compás): raíz MIDI y tipo. */
export const DEMO_CHORDS: { root: number; minor: boolean }[] = [
  { root: 48, minor: false }, { root: 43, minor: false }, { root: 45, minor: true }, { root: 41, minor: false },
]
