import * as alphaTab from '@coderline/alphatab'
import { GM_MAPPING, mapNote, type DrumMapping } from './midiMapping'
import { annotateEvents, tickToSeconds } from './timeline'
import type { DrumEvent, IgnoredHit, Section, Timeline } from './types'
import { uid } from './uid'

/**
 * Importa partituras (MusicXML, Guitar Pro 3-7, alphaTex) con el lector de
 * alphaTab y extrae los golpes de la pista de percusión al modelo común.
 * Aquí los ticks ya son musicales (vienen de una partitura), así que no hace
 * falta cuantizar: tick y tiempo coinciden exactamente con la rejilla.
 *
 * Límite conocido: las repeticiones (|: :|, voltas, D.S.) NO se expanden;
 * se importa la partitura tal y como está escrita, una sola pasada.
 */

export interface ImportedScore {
  title: string
  artist: string
  timeline: Timeline
  events: DrumEvent[]
  /** Golpes de notas sin pieza asignada (se pueden asignar después). */
  ignored: IgnoredHit[]
  sections: Section[]
  durationTicks: number
  trackNames: string[]
  percussionTrackIndex: number
  warnings: string[]
}

const DYN_TO_VELOCITY = [30, 45, 60, 75, 90, 105, 118, 127, 127, 127]

export function importScoreBytes(data: Uint8Array, fileName: string, mapping: DrumMapping = GM_MAPPING, trackIndex?: number): ImportedScore {
  const settings = new alphaTab.Settings()
  const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(data, settings)
  return extractFromScore(score, fileName, mapping, trackIndex)
}

export function extractFromScore(score: alphaTab.model.Score, fileName: string, mapping: DrumMapping = GM_MAPPING, trackIndex?: number): ImportedScore {
  const warnings: string[] = []
  const percIdx = trackIndex ?? score.tracks.findIndex((t) => t.isPercussion)
  if (percIdx < 0) throw new Error('La partitura no contiene ninguna pista de percusión.')
  const track = score.tracks[percIdx]

  const ppq = 960 // alphaTab trabaja internamente con 960 ticks por negra
  const tempos: Timeline['tempos'] = [{ tick: 0, bpm: score.tempo || 120 }]
  const timeSigs: Timeline['timeSigs'] = []
  const sections: Section[] = []
  let lastSig = ''
  let repeatsFound = false
  for (const mb of score.masterBars) {
    const sig = `${mb.timeSignatureNumerator}/${mb.timeSignatureDenominator}`
    if (sig !== lastSig) {
      timeSigs.push({ tick: mb.start, num: mb.timeSignatureNumerator, den: mb.timeSignatureDenominator })
      lastSig = sig
    }
    for (const a of mb.tempoAutomations) {
      const barLen = mb.calculateDuration()
      const tick = Math.round(mb.start + a.ratioPosition * barLen)
      if (tick === 0) tempos[0].bpm = a.value
      else tempos.push({ tick, bpm: a.value })
    }
    if (mb.section) {
      if (sections.length) sections[sections.length - 1].endBar = mb.index
      sections.push({ id: uid('s'), name: mb.section.text || mb.section.marker || `Sección ${sections.length + 1}`, startBar: mb.index, endBar: score.masterBars.length })
    }
    if (mb.isRepeatStart || mb.isRepeatEnd || mb.alternateEndings) repeatsFound = true
  }
  if (repeatsFound) warnings.push('La partitura contiene repeticiones: se importa una sola pasada (no se expanden).')
  if (mapsAnacrusis(score)) warnings.push('El primer compás es anacrusa: se trata como compás completo.')

  const timeline: Timeline = { ppq, tempos: dedupe(tempos), timeSigs }
  const events: DrumEvent[] = []
  const unknown = new Set<number>()
  const ignored: IgnoredHit[] = []
  const staff = track.staves[0]
  for (const bar of staff.bars) {
    for (const voice of bar.voices) {
      for (const beat of voice.beats) {
        if (beat.isRest || beat.notes.length === 0 || beat.graceType !== alphaTab.model.GraceType.None) continue
        const tick = beat.absolutePlaybackStart
        for (const note of beat.notes) {
          if (note.isTieDestination) continue
          let midiNote: number
          if (note.isPercussion) {
            const art = track.percussionArticulations[note.percussionArticulation]
            midiNote = art ? art.outputMidiNumber : note.percussionArticulation
          } else {
            midiNote = note.realValue
          }
          const mapped = mapNote(mapping, midiNote)
          let velocity = DYN_TO_VELOCITY[note.dynamics] ?? 90
          if (note.isGhost) velocity = Math.min(velocity, 40)
          if (note.accentuated !== alphaTab.model.AccentuationType.None) velocity = Math.max(velocity, 118)
          if (!mapped) {
            unknown.add(midiNote)
            ignored.push({ id: uid(), midiNote, time: tickToSeconds(timeline, tick), tick, velocity })
            continue
          }
          events.push({
            id: uid(),
            instrument: mapped.instrument,
            articulation: mapped.articulation,
            time: tickToSeconds(timeline, tick),
            tick,
            velocity,
            bar: 0,
            beat: 0,
            subdivision: 0,
            source: 'score',
            midiNote,
          })
        }
      }
    }
  }
  if (unknown.size) warnings.push(`Notas de percusión sin asignar (ignoradas): ${[...unknown].join(', ')}. Puedes asignarlas en «Notas MIDI».`)
  const last = score.masterBars[score.masterBars.length - 1]
  const durationTicks = last ? last.start + last.calculateDuration() : 0
  if (sections.length) sections[sections.length - 1].endBar = score.masterBars.length
  return {
    title: score.title || fileName.replace(/\.[^.]+$/, ''),
    artist: score.artist || '',
    timeline,
    events: annotateEvents(timeline, events.sort((a, b) => a.tick - b.tick)),
    ignored,
    sections,
    durationTicks,
    trackNames: score.tracks.map((t) => t.name),
    percussionTrackIndex: percIdx,
    warnings,
  }
}

function mapsAnacrusis(score: alphaTab.model.Score): boolean {
  return score.masterBars[0]?.isAnacrusis ?? false
}

function dedupe(tempos: Timeline['tempos']): Timeline['tempos'] {
  const map = new Map<number, number>()
  for (const t of tempos) map.set(t.tick, t.bpm)
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([tick, bpm]) => ({ tick, bpm }))
}
