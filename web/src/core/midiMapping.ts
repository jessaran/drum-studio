import { INSTRUMENTS, type InstrumentId } from './instruments'

/**
 * Mapeo configurable nota MIDI de percusión → pieza del SVG.
 * No todos los archivos usan la misma distribución (GM, módulos Roland,
 * librerías de VST…), así que el mapeo es editable y las notas desconocidas se
 * muestran al importar para asignarlas a mano.
 */

export interface MappedNote {
  instrument: InstrumentId
  articulation?: string
}

export interface DrumMapping {
  id: string
  name: string
  notes: Record<number, MappedNote | null>
}

export const GM_NOTE_NAMES: Record<number, string> = {
  27: 'High Q', 28: 'Slap', 29: 'Scratch Push', 30: 'Scratch Pull', 31: 'Sticks', 32: 'Square Click', 33: 'Metronome Click', 34: 'Metronome Bell',
  35: 'Acoustic Bass Drum', 36: 'Bass Drum 1', 37: 'Side Stick', 38: 'Acoustic Snare', 39: 'Hand Clap', 40: 'Electric Snare',
  41: 'Low Floor Tom', 42: 'Closed Hi-Hat', 43: 'High Floor Tom', 44: 'Pedal Hi-Hat', 45: 'Low Tom', 46: 'Open Hi-Hat',
  47: 'Low-Mid Tom', 48: 'Hi-Mid Tom', 49: 'Crash Cymbal 1', 50: 'High Tom', 51: 'Ride Cymbal 1', 52: 'Chinese Cymbal',
  53: 'Ride Bell', 54: 'Tambourine', 55: 'Splash Cymbal', 56: 'Cowbell', 57: 'Crash Cymbal 2', 58: 'Vibraslap', 59: 'Ride Cymbal 2',
  60: 'Hi Bongo', 61: 'Low Bongo', 62: 'Mute Hi Conga', 63: 'Open Hi Conga', 64: 'Low Conga', 65: 'High Timbale', 66: 'Low Timbale',
  67: 'High Agogo', 68: 'Low Agogo', 69: 'Cabasa', 70: 'Maracas', 71: 'Short Whistle', 72: 'Long Whistle', 73: 'Short Guiro',
  74: 'Long Guiro', 75: 'Claves', 76: 'Hi Wood Block', 77: 'Low Wood Block', 78: 'Mute Cuica', 79: 'Open Cuica', 80: 'Mute Triangle', 81: 'Open Triangle',
}

const m = (instrument: InstrumentId, articulation?: string): MappedNote => ({ instrument, articulation })

export const GM_MAPPING: DrumMapping = {
  id: 'gm',
  name: 'General MIDI (GM/GS/XG)',
  notes: {
    35: m('kick'), 36: m('kick'),
    37: m('snare', 'sidestick'), 38: m('snare'), 39: m('snare'), 40: m('snare'),
    41: m('floorTom'), 43: m('floorTom'),
    45: m('tom2'), 47: m('tom2'),
    48: m('tom1'), 50: m('tom1'),
    42: m('hiHat', 'closed'), 44: m('pedal'), 46: m('hiHat', 'open'),
    49: m('crash'), 57: m('crash'), 52: m('crash', 'china'), 55: m('crash', 'splash'),
    51: m('ride'), 59: m('ride'), 53: m('ride', 'bell'),
  },
}

/** Módulos Roland V-Drums (mapa por defecto): añade bordes/aros como notas propias. */
export const ROLAND_MAPPING: DrumMapping = {
  id: 'roland',
  name: 'Roland V-Drums',
  notes: {
    ...GM_MAPPING.notes,
    22: m('hiHat', 'closed'), 26: m('hiHat', 'open'),
    40: m('snare', 'rim'),
    48: m('tom1'), 50: m('tom1'),
    45: m('tom2'), 47: m('tom2'),
    43: m('floorTom'), 58: m('floorTom'),
    55: m('crash'), 52: m('crash'),
    59: m('ride'),
  },
}

export const BUILTIN_MAPPINGS: DrumMapping[] = [GM_MAPPING, ROLAND_MAPPING]

export function mapNote(mapping: DrumMapping, note: number): MappedNote | null {
  const v = mapping.notes[note]
  return v === undefined ? null : v
}

export function noteLabel(note: number): string {
  return `${note} · ${GM_NOTE_NAMES[note] ?? 'Desconocida'}`
}

export function describeMapped(mn: MappedNote | null): string {
  if (!mn) return 'Ignorar'
  return INSTRUMENTS[mn.instrument].label + (mn.articulation ? ` (${mn.articulation})` : '')
}
