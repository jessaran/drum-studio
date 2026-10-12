import { playDrum } from '../../audio/drumSynth'
import type { InstrumentId } from '../../core/instruments'
import type { Engine } from '../../engine/engine'
import type { Frame, FrameSource } from '../../engine/visualLoop'
import type { KitEvent } from './kitAnimator'

/**
 * Secuencia automática de ocho tiempos (100 BPM) que recorre todas las piezas,
 * con golpes simultáneos. Usa el reloj del AudioContext: los sonidos se
 * programan en tiempos exactos y la animación se calcula con la posición
 * audible, igual que con una canción.
 */

const BPM = 100
const BEAT = 60 / BPM

const STEPS: [number, InstrumentId[]][] = [
  [0, ['kick', 'crash']],
  [1, ['snare', 'hiHat']],
  [2, ['kick', 'hiHat', 'pedal']],
  [3, ['snare', 'ride']],
  [4, ['tom1']],
  [4.5, ['tom2']],
  [5, ['floorTom', 'kick']],
  [6, ['snare', 'hiHat', 'kick']],
  [7, ['crash', 'kick', 'floorTom']],
]

export const DEMO_SEQUENCE: KitEvent[] = STEPS.flatMap(([beat, insts]) => insts.map((instrument) => ({ instrument, time: beat * BEAT, velocity: 110 })))

export const DEMO_SEQUENCE_DURATION = 8 * BEAT

/** Reproduce la secuencia y devuelve una fuente de frames sincronizada con el audio. */
export async function playDemoSequence(engine: Engine, withSound: boolean): Promise<FrameSource & { done: Promise<void> }> {
  const ctx = await engine.ensureContext()
  const start = ctx.currentTime + 0.12
  const bus = ctx.createGain()
  bus.gain.value = 0.8
  bus.connect(ctx.destination)
  if (withSound) for (const e of DEMO_SEQUENCE) playDrum(ctx, bus, e.instrument, start + e.time, e.velocity)
  let resolveDone!: () => void
  const done = new Promise<void>((r) => (resolveDone = r))
  return {
    done,
    subscribe(cb: (f: Frame) => void) {
      let raf = 0
      let last = performance.now()
      const loop = (now: number) => {
        const pos = engine.audibleCtxTime() - start
        cb({ pos, rate: 1, playing: true, now, dt: now - last })
        last = now
        if (pos < DEMO_SEQUENCE_DURATION + 0.4) raf = requestAnimationFrame(loop)
        else resolveDone()
      }
      raf = requestAnimationFrame(loop)
      return () => cancelAnimationFrame(raf)
    },
  }
}
