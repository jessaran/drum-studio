// Catálogo de piezas de la batería. Es la única fuente de verdad para ids,
// colores, extremidad sugerida y notación (articulación alphaTab/GP7).

export const INSTRUMENT_IDS = [
  'crash',
  'ride',
  'hiHat',
  'tom1',
  'tom2',
  'snare',
  'floorTom',
  'kick',
  'pedal',
] as const

export type InstrumentId = (typeof INSTRUMENT_IDS)[number]

export type Limb = 'hand' | 'foot'

/** Qué representa el pedal central gris. Es configurable por canción. */
export type PedalRole = 'hiHatPedal' | 'doubleKick' | 'cowbell'

export interface InstrumentDef {
  id: InstrumentId
  label: string
  short: string
  /** Color principal (relleno del parche / platillo). */
  color: string
  /** Color del contorno interior del parche. */
  stroke: string
  limb: Limb
  /** Mano sugerida para un batería diestro (D/I). */
  hand: 'R' | 'L' | 'RL'
  /** Articulación por defecto (id de alphaTab / GP7) para la partitura. */
  notation: number
  /** Nota MIDI GM que se exporta por defecto. */
  gmNote: number
  /** Fila en el carril simplificado (de arriba abajo). */
  lane: number
}

export const INSTRUMENTS: Record<InstrumentId, InstrumentDef> = {
  crash: { id: 'crash', label: 'Crash', short: 'CR', color: '#f9cf45', stroke: '#e0a800', limb: 'hand', hand: 'R', notation: 49, gmNote: 49, lane: 0 },
  ride: { id: 'ride', label: 'Ride', short: 'RD', color: '#f9cf45', stroke: '#e0a800', limb: 'hand', hand: 'R', notation: 51, gmNote: 51, lane: 1 },
  hiHat: { id: 'hiHat', label: 'Hi-hat', short: 'HH', color: '#f9cf45', stroke: '#e0a800', limb: 'hand', hand: 'R', notation: 42, gmNote: 42, lane: 2 },
  tom1: { id: 'tom1', label: 'Tom 1', short: 'T1', color: '#4fbdfa', stroke: '#1f6fc4', limb: 'hand', hand: 'RL', notation: 50, gmNote: 48, lane: 3 },
  tom2: { id: 'tom2', label: 'Tom 2', short: 'T2', color: '#86ea8a', stroke: '#2f9a43', limb: 'hand', hand: 'RL', notation: 47, gmNote: 45, lane: 4 },
  snare: { id: 'snare', label: 'Caja', short: 'SN', color: '#ff9a2b', stroke: '#e0480c', limb: 'hand', hand: 'L', notation: 38, gmNote: 38, lane: 5 },
  floorTom: { id: 'floorTom', label: 'Tom de piso', short: 'FT', color: '#c873f8', stroke: '#7d34c9', limb: 'hand', hand: 'RL', notation: 43, gmNote: 43, lane: 6 },
  kick: { id: 'kick', label: 'Bombo', short: 'BD', color: '#2a2a2a', stroke: '#111111', limb: 'foot', hand: 'R', notation: 36, gmNote: 36, lane: 7 },
  pedal: { id: 'pedal', label: 'Pedal izq.', short: 'PI', color: '#9aa0a6', stroke: '#5f6368', limb: 'foot', hand: 'L', notation: 44, gmNote: 44, lane: 8 },
}

export const PEDAL_ROLES: Record<PedalRole, { label: string; notation: number; gmNote: number; limb: 'L' | 'R' }> = {
  hiHatPedal: { label: 'Pedal de hi-hat', notation: 44, gmNote: 44, limb: 'L' },
  doubleKick: { label: 'Doble bombo', notation: 35, gmNote: 35, limb: 'L' },
  cowbell: { label: 'Cencerro (pedal)', notation: 56, gmNote: 56, limb: 'L' },
}

/** Articulaciones de notación para variantes (hi-hat abierto, campana de ride…). */
export const ARTICULATION_NOTATION: Record<string, number> = {
  'hiHat:open': 46,
  'hiHat:half': 92,
  'hiHat:closed': 42,
  'ride:bell': 53,
  'snare:sidestick': 37,
  'snare:rim': 91,
  'crash:china': 52,
  'crash:splash': 55,
}

export function notationFor(instrument: InstrumentId, articulation?: string, pedalRole: PedalRole = 'hiHatPedal'): number {
  if (instrument === 'pedal') return PEDAL_ROLES[pedalRole].notation
  if (articulation) {
    const n = ARTICULATION_NOTATION[`${instrument}:${articulation}`]
    if (n !== undefined) return n
  }
  return INSTRUMENTS[instrument].notation
}

export function isFoot(instrument: InstrumentId): boolean {
  return INSTRUMENTS[instrument].limb === 'foot'
}

export function isInstrumentId(x: unknown): x is InstrumentId {
  return typeof x === 'string' && (INSTRUMENT_IDS as readonly string[]).includes(x)
}
