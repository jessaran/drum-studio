import type { ScoreBeat, ScoreModel } from './scoreModel'

/**
 * Serializa el modelo de partitura a alphaTex (formato de texto de alphaTab).
 * Notas de percusión: se escriben entre paréntesis con el id de articulación
 * GP7, p. ej. `(36 42).8`. Sin paréntesis, alphaTex interpretaría `42.8` como
 * traste.cuerda.
 */

function escape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function beatTex(b: ScoreBeat): string {
  const effects: string[] = []
  if (b.dotted) effects.push('d')
  if (b.tuplet) effects.push(`tu ${b.tuplet}`)
  const fx = effects.length ? `{${effects.join(' ')}}` : ''
  if (b.notes.length === 0) return `r.${b.duration}${fx}`
  const notes = b.notes
    .map((n) => {
      const nfx = n.velocity >= 115 ? '{ac}' : n.velocity <= 45 ? '{g}' : ''
      return `${n.notation}${nfx}`
    })
    .join(' ')
  return `(${notes}).${b.duration}${fx}`
}

export function scoreToAlphaTex(model: ScoreModel, title: string, artist: string): string {
  const lines: string[] = []
  lines.push(`\\title "${escape(title || 'Sin título')}"`)
  if (artist) lines.push(`\\artist "${escape(artist)}"`)
  const firstBpm = model.bars[0]?.bpm ?? 120
  lines.push(`\\tempo ${Math.round(firstBpm * 100) / 100}`)
  lines.push(`\\track "Batería" \\instrument percussion`)
  for (const v of [0, 1] as const) {
    lines.push('\\voice')
    const bars = model.bars.map((bar) => {
      const meta: string[] = []
      if (v === 0 && bar.timeSigChanged) meta.push(`\\ts (${bar.info.num} ${bar.info.den})`)
      if (v === 0 && bar.index > 0 && bar.bpm !== undefined) meta.push(`\\tempo ${Math.round(bar.bpm * 100) / 100}`)
      const beats = bar.voices[v].map(beatTex).join(' ')
      return `${meta.join(' ')}${meta.length ? ' ' : ''}${beats}`
    })
    lines.push(bars.join(' |\n') + ' |')
  }
  return lines.join('\n')
}
