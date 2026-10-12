import { describe, expect, it } from 'vitest'
import { PlaybackClock } from './clock'
import { LookaheadScheduler, type TimedItem } from './scheduler'

/**
 * Pruebas de sincronización del reloj + scheduler con un reloj de audio simulado.
 * El temporizador se despierta con jitter aleatorio (10–90 ms, con pausas largas
 * ocasionales) y se comprueba que:
 *  - cada golpe se programa exactamente una vez,
 *  - en el instante exacto del reloj de audio (error < 1 µs),
 *  - con antelación positiva (nunca tarde) mientras el retraso del temporizador < lookahead.
 */

interface Item extends TimedItem {
  id: number
}

function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0xffffffff
  }
}

function makeItems(n: number, spacing: number): Item[] {
  return Array.from({ length: n }, (_, i) => ({ id: i, time: i * spacing }))
}

function setup(items: Item[], lookahead = 0.2) {
  const clock = new PlaybackClock()
  const sched = new LookaheadScheduler(clock, { lookahead })
  const emitted: { id: number; ctx: number; emittedAt: number }[] = []
  let now = 0
  sched.addSource({ items, enabled: () => true, emit: (it, ctx) => emitted.push({ id: it.id, ctx, emittedAt: now }) })
  return {
    clock,
    sched,
    emitted,
    get now() {
      return now
    },
    advance(dt: number) {
      now += dt
      sched.tick(now)
    },
  }
}

describe('PlaybackClock', () => {
  it('posición continua al cambiar de velocidad', () => {
    const c = new PlaybackClock()
    c.start(1, 0, 1)
    const t = 3
    const posBefore = c.songPosAt(t)
    c.pushAnchor({ ctxTime: t, songPos: posBefore, rate: 0.5 })
    expect(c.songPosAt(t)).toBeCloseTo(posBefore, 12)
    expect(c.songPosAt(t + 2)).toBeCloseTo(posBefore + 1, 12)
  })

  it('pausa y reanuda sin perder posición', () => {
    const c = new PlaybackClock()
    c.start(0, 10, 1)
    const p = c.pause(2.5)
    expect(p).toBeCloseTo(12.5, 12)
    expect(c.songPosAt(100)).toBeCloseTo(12.5, 12)
    c.start(50, p, 1)
    expect(c.songPosAt(51)).toBeCloseTo(13.5, 12)
  })
})

describe('LookaheadScheduler', () => {
  it('programa cada golpe una vez y en su instante exacto pese al jitter del temporizador', () => {
    const items = makeItems(2000, 0.0625) // semicorcheas a 240 BPM, 125 s
    const env = setup(items)
    env.clock.start(0.05, 0, 1)
    env.sched.reset(0)
    const r = rng(42)
    while (env.now < 126) env.advance(r() < 0.02 ? 0.15 : 0.01 + r() * 0.08)
    expect(env.emitted.length).toBe(items.length)
    const ids = new Set(env.emitted.map((e) => e.id))
    expect(ids.size).toBe(items.length)
    let maxErr = 0
    let minLead = Infinity
    for (const e of env.emitted) {
      const expected = 0.05 + items[e.id].time
      maxErr = Math.max(maxErr, Math.abs(e.ctx - expected))
      minLead = Math.min(minLead, e.ctx - e.emittedAt)
    }
    expect(maxErr).toBeLessThan(1e-6)
    expect(minLead).toBeGreaterThanOrEqual(0)
  })

  it('cambio de velocidad a mitad: tiempos exactos según el nuevo ritmo', () => {
    const items = makeItems(400, 0.25)
    const env = setup(items)
    env.clock.start(0, 0, 1)
    env.sched.reset(0)
    while (env.now < 10) env.advance(0.025)
    // A 10 s de reloj: cambio a 0.5x (como hace el motor: ancla en el futuro cercano, reset de ventana).
    const t = env.now + 0.04
    const pos = env.clock.songPosAt(t)
    env.clock.pushAnchor({ ctxTime: t, songPos: pos, rate: 0.5 })
    // El motor cancela lo programado a partir de t: lo simulamos descartando esos elementos.
    const kept = env.emitted.filter((e) => e.ctx < t)
    env.emitted.length = 0
    env.emitted.push(...kept)
    env.sched.reset(env.now)
    while (env.now < 60) env.advance(0.03)
    const ids = env.emitted.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length) // sin duplicados
    for (const e of env.emitted) {
      const time = items[e.id].time
      const expected = time < pos ? time : t + (time - pos) / 0.5
      expect(Math.abs(e.ctx - expected)).toBeLessThan(1e-6)
    }
    // Todos los elementos hasta la posición alcanzada se han programado.
    const reached = env.clock.songPosAt(60)
    expect(env.emitted.filter((e) => items[e.id].time < reached - 0.25).length).toBe(Math.ceil((reached - 0.25) / 0.25))
  })

  it('salto (seek) hacia atrás: reprograma desde la nueva posición', () => {
    const items = makeItems(100, 0.5)
    const env = setup(items)
    env.clock.start(0, 0, 1)
    env.sched.reset(0)
    while (env.now < 20) env.advance(0.025)
    const t = env.now + 0.04
    env.clock.pushAnchor({ ctxTime: t, songPos: 5, rate: 1 })
    const before = env.emitted.filter((e) => e.ctx < t)
    env.emitted.length = 0
    env.sched.reset(env.now)
    while (env.now < 23) env.advance(0.025)
    const first = env.emitted[0]
    expect(items[first.id].time).toBe(5)
    expect(first.ctx).toBeCloseTo(t, 9)
    expect(before.length).toBeGreaterThan(0)
  })

  it('bucle: salta al inicio con exactitud y repite los golpes', () => {
    const items = makeItems(64, 0.25) // 16 s
    const env = setup(items)
    const anchors: number[] = []
    env.sched.loop = { start: 2, end: 4 }
    env.sched.onLoopAnchor = (a) => anchors.push(a.ctxTime)
    env.clock.start(0, 2, 1)
    env.sched.reset(0)
    const r = rng(7)
    while (env.now < 10) env.advance(0.01 + r() * 0.05)
    // Vueltas en t = 2, 4, 6, 8, 10 (cada 2 s)
    expect(anchors.slice(0, 4).map((x) => Math.round(x * 1e6) / 1e6)).toEqual([2, 4, 6, 8])
    const times = env.emitted.map((e) => items[e.id].time)
    expect(Math.max(...times)).toBeLessThan(4)
    expect(Math.min(...times)).toBe(2)
    // Por vuelta: 8 golpes (2..3.75)
    const firstLoop = env.emitted.filter((e) => e.ctx < 2)
    expect(firstLoop.length).toBe(8)
    for (const e of env.emitted) {
      const lap = Math.floor((e.ctx + 1e-9) / 2)
      expect(e.ctx).toBeCloseTo(lap * 2 + (items[e.id].time - 2), 9)
    }
  })

  it('cuenta previa: el ancla en el futuro no emite nada antes de tiempo', () => {
    const items = makeItems(10, 0.5)
    const env = setup(items)
    env.clock.start(2, 0, 1) // la canción empieza en t=2 (tras 4 pulsos)
    env.sched.reset(0)
    while (env.now < 1.5) env.advance(0.025)
    expect(env.emitted.length).toBe(0)
    while (env.now < 3) env.advance(0.025)
    expect(env.emitted[0].ctx).toBeCloseTo(2, 9)
  })
})

describe('jitter visual (requestAnimationFrame simulado)', () => {
  it('el retraso de activación visual está acotado por un frame', () => {
    // Cada frame calcula el estado a partir de la posición real: el error máximo es el intervalo entre frames.
    const r = rng(3)
    const hits = makeItems(500, 0.137).map((h) => h.time)
    const delays: number[] = []
    let t = 0
    let hi = 0
    while (t < 70) {
      const dt = (1000 / 60 + (r() - 0.5) * 6) / 1000 // 60 Hz con ±3 ms de jitter
      t += dt
      while (hi < hits.length && hits[hi] <= t) {
        delays.push(t - hits[hi])
        hi++
      }
    }
    const max = Math.max(...delays) * 1000
    const mean = (delays.reduce((a, b) => a + b, 0) / delays.length) * 1000
    expect(max).toBeLessThan(20)
    expect(mean).toBeLessThan(10)
  })
})
