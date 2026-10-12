import { engine } from './engine'
import { VisualLoop } from './visualLoop'

/** Única fuente de frames de la app: todos los elementos visuales leen la misma posición. */
export const frames = new VisualLoop(() => ({ pos: engine.visualPosition(), rate: engine.clock.rate, playing: engine.clock.playing }))
