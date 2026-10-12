import type { DrumEvent, Timeline } from './types'

export const PPQ = 960

export function createTimeline(bpm: number, num = 4, den = 4, ppq = PPQ): Timeline {
  return { ppq, tempos: [{ tick: 0, bpm }], timeSigs: [{ tick: 0, num, den }] }
}

interface TempoSegment {
  tick: number
  time: number
  bpm: number
}

const segCache = new WeakMap<Timeline, TempoSegment[]>()

function segments(tl: Timeline): TempoSegment[] {
  let segs = segCache.get(tl)
  if (segs) return segs
  const tempos = [...tl.tempos].sort((a, b) => a.tick - b.tick)
  if (tempos.length === 0 || tempos[0].tick > 0) tempos.unshift({ tick: 0, bpm: tempos[0]?.bpm ?? 120 })
  segs = []
  let time = 0
  for (let i = 0; i < tempos.length; i++) {
    const t = tempos[i]
    if (i > 0) {
      const prev = tempos[i - 1]
      time += ((t.tick - prev.tick) / tl.ppq) * (60 / prev.bpm)
    }
    segs.push({ tick: t.tick, time, bpm: t.bpm })
  }
  segCache.set(tl, segs)
  return segs
}

export function tickToSeconds(tl: Timeline, tick: number): number {
  const segs = segments(tl)
  let s = segs[0]
  for (let i = 1; i < segs.length && segs[i].tick <= tick; i++) s = segs[i]
  return s.time + ((tick - s.tick) / tl.ppq) * (60 / s.bpm)
}

export function secondsToTick(tl: Timeline, seconds: number): number {
  const segs = segments(tl)
  let s = segs[0]
  for (let i = 1; i < segs.length && segs[i].time <= seconds; i++) s = segs[i]
  return s.tick + ((seconds - s.time) * s.bpm * tl.ppq) / 60
}

export function bpmAtTick(tl: Timeline, tick: number): number {
  const segs = segments(tl)
  let s = segs[0]
  for (let i = 1; i < segs.length && segs[i].tick <= tick; i++) s = segs[i]
  return s.bpm
}

export interface BarInfo {
  index: number
  startTick: number
  endTick: number
  num: number
  den: number
  /** Ticks por tiempo (pulso) de este compás. */
  beatTicks: number
  startTime: number
  endTime: number
}

/** Lista de compases que cubren hasta `endTick` (incluido el compás que lo contiene). */
export function computeBars(tl: Timeline, endTick: number): BarInfo[] {
  const sigs = [...tl.timeSigs].sort((a, b) => a.tick - b.tick)
  if (sigs.length === 0 || sigs[0].tick > 0) sigs.unshift({ tick: 0, num: 4, den: 4 })
  const bars: BarInfo[] = []
  let tick = 0
  let si = 0
  const maxBars = 10000
  while ((tick <= endTick || bars.length === 0) && bars.length < maxBars) {
    while (si + 1 < sigs.length && sigs[si + 1].tick <= tick) si++
    const { num, den } = sigs[si]
    const beatTicks = (tl.ppq * 4) / den
    const len = beatTicks * num
    bars.push({
      index: bars.length,
      startTick: tick,
      endTick: tick + len,
      num,
      den,
      beatTicks,
      startTime: tickToSeconds(tl, tick),
      endTime: tickToSeconds(tl, tick + len),
    })
    tick += len
    if (tick > endTick) break
  }
  return bars
}

export function barIndexAtTick(bars: BarInfo[], tick: number): number {
  let lo = 0
  let hi = bars.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (bars[mid].startTick <= tick) lo = mid
    else hi = mid - 1
  }
  return lo
}

export function barIndexAtTime(bars: BarInfo[], time: number): number {
  let lo = 0
  let hi = bars.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (bars[mid].startTime <= time) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** Rellena bar/beat/subdivision a partir del tick cuantizado. */
export function annotateEvents(tl: Timeline, events: DrumEvent[]): DrumEvent[] {
  if (events.length === 0) return events
  const maxTick = events.reduce((m, e) => Math.max(m, e.tick), 0)
  const bars = computeBars(tl, maxTick)
  return events.map((e) => {
    const b = bars[barIndexAtTick(bars, e.tick)]
    const rel = e.tick - b.startTick
    const beat = Math.floor(rel / b.beatTicks)
    const subdivision = (rel - beat * b.beatTicks) / b.beatTicks
    return { ...e, bar: b.index, beat, subdivision: Math.round(subdivision * 1000) / 1000 }
  })
}

/** Tiempos (s) de todos los pulsos entre t0 y t1, con marca de primer tiempo de compás. */
export function beatsInRange(tl: Timeline, bars: BarInfo[], t0: number, t1: number): { time: number; downbeat: boolean; tick: number }[] {
  const out: { time: number; downbeat: boolean; tick: number }[] = []
  if (bars.length === 0) return out
  let bi = barIndexAtTime(bars, Math.max(0, t0))
  for (; bi < bars.length; bi++) {
    const b = bars[bi]
    if (b.startTime > t1) break
    for (let k = 0; k < b.num; k++) {
      const tick = b.startTick + k * b.beatTicks
      const time = tickToSeconds(tl, tick)
      if (time >= t0 && time < t1) out.push({ time, downbeat: k === 0, tick })
    }
  }
  return out
}

export function sortEvents(events: DrumEvent[]): DrumEvent[] {
  return [...events].sort((a, b) => a.time - b.time || a.tick - b.tick || a.instrument.localeCompare(b.instrument))
}
