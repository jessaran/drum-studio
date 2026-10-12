import { INSTRUMENTS, type InstrumentId } from './instruments'
import type { ScoreBeat, ScoreModel } from './scoreModel'

/**
 * Exportación a MusicXML 4.0 (partwise) desde el modelo de partitura cuantizado.
 * Percusión no afinada: clave de percusión, <unpitched> con la posición en el
 * pentagrama, instrumentos con <midi-unpitched> (GM, base 1) y cabezas en "x"
 * para platillos. Dos voces (manos / pies) separadas con <backup>.
 *
 * Validación: las pruebas reimportan el XML con el lector MusicXML de alphaTab
 * y comprueban que todos los golpes vuelven con el mismo tick e instrumento.
 */

const DIVISIONS = 24 // por negra: admite fusas (3), tresillos de corchea (8) y seisillos (4)

const TYPE: Record<ScoreBeat['duration'], string> = { 1: 'whole', 2: 'half', 4: 'quarter', 8: 'eighth', 16: '16th', 32: '32nd' }

/** Posición en el pentagrama (clave de percusión estándar). */
const DISPLAY: Record<InstrumentId, [string, number]> = {
  crash: ['A', 5],
  ride: ['F', 5],
  hiHat: ['G', 5],
  tom1: ['E', 5],
  tom2: ['D', 5],
  snare: ['C', 5],
  floorTom: ['A', 4],
  kick: ['F', 4],
  pedal: ['D', 4],
}

/** Articulación GP7 → nota MIDI de salida. */
const OUT_MIDI: Record<number, number> = { 92: 46, 91: 38, 93: 51, 94: 51, 95: 55, 96: 52, 97: 49, 98: 57 }
const outMidi = (n: number) => OUT_MIDI[n] ?? n

const XNOTE = new Set([42, 44, 46, 49, 51, 52, 55, 57, 92, 93, 94, 97, 98])

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function scoreToMusicXml(model: ScoreModel, title: string, artist: string): string {
  const ppqToDiv = model.ppq / DIVISIONS
  // Instrumentos usados (uno por articulación).
  const used = new Map<number, InstrumentId>()
  for (const bar of model.bars) for (const v of bar.voices) for (const b of v) for (const n of b.notes) used.set(n.notation, n.instrument)
  const instId = (n: number) => `P1-I${n}`

  const out: string[] = []
  out.push('<?xml version="1.0" encoding="UTF-8" standalone="no"?>')
  out.push('<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">')
  out.push('<score-partwise version="4.0">')
  out.push(`  <work><work-title>${esc(title)}</work-title></work>`)
  out.push(`  <identification>${artist ? `<creator type="composer">${esc(artist)}</creator>` : ''}<encoding><software>DrumStudio</software></encoding></identification>`)
  out.push('  <part-list>')
  out.push('    <score-part id="P1">')
  out.push('      <part-name>Batería</part-name>')
  for (const [n, inst] of used) out.push(`      <score-instrument id="${instId(n)}"><instrument-name>${esc(INSTRUMENTS[inst].label)} (${n})</instrument-name></score-instrument>`)
  for (const [n] of used) out.push(`      <midi-instrument id="${instId(n)}"><midi-channel>10</midi-channel><midi-unpitched>${outMidi(n) + 1}</midi-unpitched></midi-instrument>`)
  out.push('    </score-part>')
  out.push('  </part-list>')
  out.push('  <part id="P1">')

  for (const bar of model.bars) {
    out.push(`    <measure number="${bar.index + 1}">`)
    if (bar.index === 0 || bar.timeSigChanged) {
      out.push('      <attributes>')
      if (bar.index === 0) out.push(`        <divisions>${DIVISIONS}</divisions>`)
      out.push(`        <time><beats>${bar.info.num}</beats><beat-type>${bar.info.den}</beat-type></time>`)
      if (bar.index === 0) out.push('        <clef><sign>percussion</sign><line>2</line></clef>')
      out.push('      </attributes>')
    }
    if (bar.bpm !== undefined) {
      const bpm = Math.round(bar.bpm * 100) / 100
      out.push(`      <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${bpm}</per-minute></metronome></direction-type><sound tempo="${bpm}"/></direction>`)
    }
    const barLen = (bar.info.endTick - bar.info.startTick) / ppqToDiv
    bar.voices.forEach((beats, vi) => {
      if (vi === 1) out.push(`      <backup><duration>${barLen}</duration></backup>`)
      const voice = vi + 1
      const stem = vi === 0 ? 'up' : 'down'
      for (const b of beats) {
        const dur = b.durationTicks / ppqToDiv
        const tm = b.tuplet ? `<time-modification><actual-notes>${b.tuplet}</actual-notes><normal-notes>${b.tuplet === 3 ? 2 : 4}</normal-notes></time-modification>` : ''
        const dot = b.dotted ? '<dot/>' : ''
        if (b.notes.length === 0) {
          out.push(`      <note><rest/><duration>${dur}</duration><voice>${voice}</voice><type>${TYPE[b.duration]}</type>${dot}${tm}</note>`)
          continue
        }
        b.notes.forEach((n, k) => {
          const [step, oct] = DISPLAY[n.instrument]
          const head = XNOTE.has(n.notation) ? (n.notation === 46 ? '<notehead>circle-x</notehead>' : '<notehead>x</notehead>') : n.velocity <= 45 ? '<notehead parentheses="yes">normal</notehead>' : ''
          const accent = n.velocity >= 115 ? '<notations><articulations><accent/></articulations></notations>' : ''
          out.push(
            `      <note>${k > 0 ? '<chord/>' : ''}<unpitched><display-step>${step}</display-step><display-octave>${oct}</display-octave></unpitched><duration>${dur}</duration><instrument id="${instId(n.notation)}"/><voice>${voice}</voice><type>${TYPE[b.duration]}</type>${dot}${tm}<stem>${stem}</stem>${head}${accent}</note>`,
          )
        })
      }
    })
    out.push('    </measure>')
  }
  out.push('  </part>')
  out.push('</score-partwise>')
  return out.join('\n')
}
