import type { DrumEvent, Song } from './types'

export type Level = 'beginner' | 'intermediate' | 'advanced'

export const LEVEL_LABEL: Record<Level, string> = {
  beginner: 'Principiante',
  intermediate: 'Intermedio',
  advanced: 'Avanzado',
}

export interface LevelResult {
  events: DrumEvent[]
  /** 'author' = variante escrita a mano incluida en la canción; 'reduced' = subconjunto automático; 'full' = original. */
  kind: 'author' | 'reduced' | 'full'
  description: string
}

/**
 * Niveles de dificultad. Si la canción trae una variante simplificada escrita
 * por un autor, se usa esa. Si no, se aplica una REDUCCIÓN: solo se quitan
 * golpes (nunca se añaden ni se mueven), así que lo que queda sigue siendo
 * exactamente lo que suena en la grabación.
 */
export function eventsForLevel(song: Song, level: Level): LevelResult {
  if (level === 'advanced') return { events: song.events, kind: 'full', description: 'Todos los golpes.' }
  const authored = song.levels?.[level]
  if (authored && authored.length) return { events: authored, kind: 'author', description: 'Variante simplificada incluida en la canción.' }
  const ppq = song.timeline.ppq
  if (level === 'intermediate') {
    return {
      events: song.events.filter((e) => e.velocity > 45 && e.tick % (ppq / 4) === 0),
      kind: 'reduced',
      description: 'Reducción automática: sin notas fantasma ni figuras más rápidas que la semicorchea (no se añaden golpes).',
    }
  }
  return {
    events: song.events.filter((e) => e.velocity > 45 && e.tick % (ppq / 2) === 0 && e.instrument !== 'pedal'),
    kind: 'reduced',
    description: 'Reducción automática: solo golpes en corcheas, sin fantasmas ni pedal de hi-hat (no se añaden golpes; puede sonar diferente a la grabación).',
  }
}
