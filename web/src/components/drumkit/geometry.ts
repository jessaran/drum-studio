import type { InstrumentId, PedalRole } from '../../core/instruments'

/**
 * Geometría de la batería, medida sobre la imagen de referencia (1254×1254 px).
 * Las coordenadas son del viewBox: el SVG escala sin perder proporciones.
 */

export type PieceKind = 'cymbal' | 'drum' | 'pedal'

export interface PieceGeometry {
  id: InstrumentId
  kind: PieceKind
  cx: number
  cy: number
  /** Radio exterior (aro / borde del platillo). */
  r: number
  /** Radio del parche (tambores). */
  head?: number
  lugs?: number
  /** Ángulo inicial de las orejetas (grados). */
  lugOffset?: number
  /** Colores de los anillos concéntricos del platillo, de fuera adentro. */
  rings?: string[]
}

export const VIEWBOX = { x: 20, y: 120, w: 1215, h: 760 }

const CYMBAL_RINGS = ['#fcd94f', '#f8c93a', '#fad54a', '#fde061']

export const PIECES: PieceGeometry[] = [
  { id: 'crash', kind: 'cymbal', cx: 205, cy: 312, r: 174, rings: CYMBAL_RINGS },
  { id: 'ride', kind: 'cymbal', cx: 1040, cy: 312, r: 174, rings: CYMBAL_RINGS },
  { id: 'hiHat', kind: 'cymbal', cx: 157, cy: 700, r: 117, rings: CYMBAL_RINGS },
  { id: 'tom1', kind: 'drum', cx: 487, cy: 486, r: 128, head: 110, lugs: 6, lugOffset: -90 },
  { id: 'tom2', kind: 'drum', cx: 767, cy: 486, r: 128, head: 110, lugs: 6, lugOffset: -90 },
  { id: 'snare', kind: 'drum', cx: 405, cy: 745, r: 122, head: 105, lugs: 6, lugOffset: -90 },
  { id: 'floorTom', kind: 'drum', cx: 940, cy: 740, r: 138, head: 120, lugs: 6, lugOffset: -90 },
  // El bombo se representa solo con su pedal (el tambor grande queda "debajo", no se dibuja).
  { id: 'kick', kind: 'pedal', cx: 628, cy: 712, r: 100 },
]

export const PIECE_BY_ID = Object.fromEntries(PIECES.map((p) => [p.id, p])) as Partial<Record<InstrumentId, PieceGeometry>>

/**
 * Pieza del dibujo en la que se muestra cada instrumento. Los golpes de
 * "pedal" (pie izquierdo) se muestran en el hi-hat si es el pedal de hi-hat,
 * o en el pedal de bombo si es doble bombo / cencerro de pedal.
 */
export function visualPiece(id: InstrumentId, pedalRole: PedalRole = 'hiHatPedal'): InstrumentId {
  if (id !== 'pedal') return id
  return pedalRole === 'hiHatPedal' ? 'hiHat' : 'kick'
}

/** Geometría del pedal central (campana trapezoidal + mando). */
export const PEDAL_SHAPE = {
  knob: { cx: 628, cy: 612, r: 31 },
  stem: { x: 618, y: 640, w: 20, h: 45 },
  body: 'M590 680 L666 680 Q672 680 673 686 L689 812 Q690 824 678 824 L578 824 Q566 824 567 812 L583 686 Q584 680 590 680 Z',
  window: 'M597 694 L659 694 L664 760 L592 760 Z',
}
