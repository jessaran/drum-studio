import { barIndexAtTick, computeBars, secondsToTick, tickToSeconds } from './timeline'
import type { DrumEvent, Timeline } from './types'

/**
 * Cuantización musical.
 *
 * Una secuencia MIDI o de golpes detectados NO es una partitura: los tiempos son
 * continuos. Aquí se decide, pulso a pulso, qué rejilla describe mejor los golpes
 * (binaria: semicorcheas/fusas; ternaria: tresillos de corchea/seisillos) y se
 * ajusta cada golpe a esa rejilla. La partitura se genera después a partir de
 * estos ticks.
 *
 * Límites conocidos (se indican en la interfaz):
 * - Un pulso usa una única rejilla; no se mezclan tresillos y semicorcheas en el mismo pulso.
 * - No se detectan quintillos, septillos ni grupos que crucen el pulso.
 * - Solo se reconocen tresillos en compases cuyo pulso es una negra (x/4, x/2).
 */

export interface GridOption {
  id: 'q16' | 'q32' | 't8' | 't16' | 'q8'
  label: string
  /** Fracción del pulso de negra. */
  divisions: number
  ternary: boolean
}

export const GRIDS: GridOption[] = [
  { id: 'q8', label: 'Corcheas', divisions: 2, ternary: false },
  { id: 'q16', label: 'Semicorcheas', divisions: 4, ternary: false },
  { id: 'q32', label: 'Fusas', divisions: 8, ternary: false },
  { id: 't8', label: 'Tresillos de corchea', divisions: 3, ternary: true },
  { id: 't16', label: 'Seisillos', divisions: 6, ternary: true },
]

export interface QuantizeOptions {
  /** Subdivisión binaria máxima: 4 = semicorcheas, 8 = fusas. */
  maxBinary: 2 | 4 | 8
  allowTriplets: boolean
  /** Penalización (en fracción de rejilla) por elegir una rejilla más compleja. */
  complexityPenalty: number
}

export const DEFAULT_QUANTIZE: QuantizeOptions = { maxBinary: 8, allowTriplets: true, complexityPenalty: 0.04 }

export interface BeatGridChoice {
  bar: number
  beat: number
  startTick: number
  grid: GridOption
}

function candidateGrids(opts: QuantizeOptions, beatIsQuarterBased: boolean): GridOption[] {
  return GRIDS.filter((g) => {
    if (g.ternary) return opts.allowTriplets && beatIsQuarterBased
    return g.divisions <= opts.maxBinary
  })
}

/**
 * Cuantiza los eventos usando `rawTick` (o el tick actual si no existe).
 * Devuelve eventos nuevos con `tick` cuantizado y `rawTick` preservado.
 * El campo `time` (interpretación real) NO se modifica.
 */
export function quantizeEvents(
  tl: Timeline,
  events: DrumEvent[],
  opts: QuantizeOptions = DEFAULT_QUANTIZE,
): { events: DrumEvent[]; grids: BeatGridChoice[] } {
  if (events.length === 0) return { events, grids: [] }
  const raw = events.map((e) => e.rawTick ?? e.tick)
  const maxTick = Math.max(...raw)
  const bars = computeBars(tl, maxTick + tl.ppq * 8)

  // Agrupa por pulso. Se desplaza 1/16 de pulso para que un golpe ligeramente
  // adelantado al pulso siguiente pertenezca a ese pulso.
  const byBeat = new Map<string, number[]>()
  raw.forEach((t, i) => {
    const probe = Math.max(0, t + bars[barIndexAtTick(bars, Math.max(0, t))].beatTicks / 16)
    const bi = barIndexAtTick(bars, probe)
    const b = bars[bi]
    const beat = Math.min(Math.floor((probe - b.startTick) / b.beatTicks), b.num - 1)
    const k = `${bi}:${beat}`
    const arr = byBeat.get(k)
    if (arr) arr.push(i)
    else byBeat.set(k, [i])
  })

  const out = events.map((e) => ({ ...e }))
  const grids: BeatGridChoice[] = []
  for (const [k, idxs] of byBeat) {
    const [biS, beatS] = k.split(':')
    const b = bars[Number(biS)]
    const beat = Number(beatS)
    const beatStart = b.startTick + beat * b.beatTicks
    const quarterBased = b.den <= 4
    let best: { grid: GridOption; cost: number } | null = null
    for (const g of candidateGrids(opts, quarterBased)) {
      // `divisions` se refiere a la negra; el error se mide en fracciones de
      // semicorchea para que las rejillas finas no ganen siempre.
      const step = tl.ppq / g.divisions
      const errTicks =
        idxs.reduce((s, i) => {
          const rel = raw[i] - beatStart
          return s + Math.abs(rel - Math.round(rel / step) * step)
        }, 0) / idxs.length
      const complexity = (g.ternary ? 1.5 : 0) + Math.log2(g.divisions)
      const cost = errTicks / (tl.ppq / 4) + complexity * opts.complexityPenalty
      if (!best || cost < best.cost) best = { grid: g, cost }
    }
    const grid = best!.grid
    grids.push({ bar: b.index, beat, startTick: beatStart, grid })
    const step = tl.ppq / grid.divisions
    for (const i of idxs) {
      const rel = raw[i] - beatStart
      let q = beatStart + Math.round(rel / step) * step
      if (q < 0) q = 0
      out[i].tick = Math.round(q)
      out[i].rawTick = raw[i]
    }
  }
  grids.sort((a, b) => a.startTick - b.startTick)
  return { events: dedupe(out), grids }
}

/** Tras cuantizar, dos golpes del mismo instrumento pueden caer en el mismo tick: se conserva el más fuerte. */
function dedupe(events: DrumEvent[]): DrumEvent[] {
  const map = new Map<string, DrumEvent>()
  for (const e of events) {
    const k = `${e.instrument}@${e.tick}`
    const prev = map.get(k)
    if (!prev || e.velocity > prev.velocity) map.set(k, e)
  }
  return [...map.values()].sort((a, b) => a.tick - b.tick || a.time - b.time)
}

/** Pasa de tiempos (segundos) a ticks crudos usando el mapa de tempo. */
export function assignRawTicks(tl: Timeline, events: DrumEvent[]): DrumEvent[] {
  return events.map((e) => ({ ...e, rawTick: secondsToTick(tl, e.time), tick: Math.round(secondsToTick(tl, e.time)) }))
}

/** "Corregir cuantización": lleva el tiempo de interpretación exactamente a la rejilla. */
export function snapTimesToTicks(tl: Timeline, events: DrumEvent[]): DrumEvent[] {
  return events.map((e) => ({ ...e, time: tickToSeconds(tl, e.tick) }))
}
