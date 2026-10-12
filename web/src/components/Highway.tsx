import { useEffect, useMemo, useRef } from 'react'
import { INSTRUMENT_IDS, INSTRUMENTS, type InstrumentId } from '../core/instruments'
import { beatsInRange, computeBars, secondsToTick } from '../core/timeline'
import type { DrumEvent, Song } from '../core/types'
import type { FrameSource } from '../engine/visualLoop'

/**
 * Vista simplificada: un carril por pieza; los golpes son bloques de color que
 * avanzan hacia la línea de golpe. Se dibuja en canvas una vez por frame con
 * la misma posición que el resto de la interfaz.
 */

interface Props {
  song: Song
  events: DrumEvent[]
  frames: FrameSource
  dark: boolean
  /** Segundos REALES visibles por delante de la línea de golpe. */
  lookAhead?: number
  onSeek: (t: number) => void
}

const HIT_X = 0.18

export function Highway({ song, events, frames, dark, lookAhead = 3, onSeek }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const bars = useMemo(() => computeBars(song.timeline, secondsToTick(song.timeline, song.duration)), [song.timeline, song.duration])
  const sorted = useMemo(() => [...events].sort((a, b) => a.time - b.time), [events])
  const lanes: InstrumentId[] = useMemo(() => {
    const used = new Set(events.map((e) => e.instrument))
    const l = INSTRUMENT_IDS.filter((id) => used.has(id))
    return (l.length ? l : [...INSTRUMENT_IDS]).sort((a, b) => INSTRUMENTS[a].lane - INSTRUMENTS[b].lane)
  }, [events])
  const lastPos = useRef(0)
  const lastRate = useRef(1)

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    const draw = (pos: number, rate: number) => {
      const dpr = window.devicePixelRatio || 1
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr)
        canvas.height = Math.round(h * dpr)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      const labelW = 56
      const hitX = labelW + (w - labelW) * HIT_X
      const pxPerSec = (w - hitX) / (lookAhead * rate) // en segundos de canción
      const laneH = h / lanes.length
      const t0 = pos - (hitX - labelW) / pxPerSec
      const t1 = pos + (w - hitX) / pxPerSec
      const xOf = (t: number) => hitX + (t - pos) * pxPerSec

      // Carriles
      lanes.forEach((_id, i) => {
        ctx.fillStyle = i % 2 ? (dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.025)') : 'transparent'
        ctx.fillRect(labelW, i * laneH, w - labelW, laneH)
      })
      // Pulsos y compases
      for (const b of beatsInRange(song.timeline, bars, Math.max(0, t0), t1)) {
        const x = xOf(b.time)
        ctx.fillStyle = b.downbeat ? (dark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.3)') : dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'
        ctx.fillRect(x - (b.downbeat ? 1 : 0.5), 0, b.downbeat ? 2 : 1, h)
      }
      // Golpes
      let i = lowerBound(sorted, t0 - 0.2)
      const blockW = Math.max(10, Math.min(26, pxPerSec * 0.07))
      for (; i < sorted.length && sorted[i].time <= t1; i++) {
        const e = sorted[i]
        const lane = lanes.indexOf(e.instrument)
        if (lane < 0) continue
        const x = xOf(e.time)
        const def = INSTRUMENTS[e.instrument]
        const passed = e.time <= pos
        const fresh = passed && (pos - e.time) / rate < 0.15
        const y = lane * laneH + laneH * 0.14
        const bh = laneH * 0.72
        ctx.globalAlpha = passed && !fresh ? 0.28 : 0.4 + 0.6 * (e.velocity / 127)
        ctx.fillStyle = e.instrument === 'kick' ? (dark ? '#c9ced6' : '#2a2a2a') : def.color
        roundRect(ctx, x - blockW / 2, fresh ? y - 2 : y, blockW, fresh ? bh + 4 : bh, 5)
        ctx.fill()
        if (e.source === 'ai' && (e.confidence ?? 1) < 0.6) {
          ctx.strokeStyle = '#ff4d4f'
          ctx.lineWidth = 2
          ctx.stroke()
        }
        ctx.globalAlpha = 1
      }
      // Línea de golpe
      ctx.fillStyle = dark ? '#ffffff' : '#111111'
      ctx.fillRect(hitX - 1.5, 0, 3, h)
      // Etiquetas
      ctx.fillStyle = dark ? '#16181d' : '#f7f7f9'
      ctx.fillRect(0, 0, labelW, h)
      ctx.font = '600 11px ui-sans-serif, system-ui, -apple-system'
      ctx.textBaseline = 'middle'
      lanes.forEach((id, li) => {
        const def = INSTRUMENTS[id]
        ctx.fillStyle = id === 'kick' ? (dark ? '#c9ced6' : '#2a2a2a') : def.color
        roundRect(ctx, 6, li * laneH + laneH * 0.2, 8, laneH * 0.6, 3)
        ctx.fill()
        ctx.fillStyle = dark ? '#d6d9df' : '#33363c'
        ctx.fillText(def.short, 20, li * laneH + laneH / 2)
      })
    }
    const unsub = frames.subscribe((f) => {
      lastPos.current = f.pos
      lastRate.current = f.rate
      draw(f.pos, f.rate)
    })
    return unsub
  }, [frames, sorted, lanes, bars, dark, lookAhead, song.timeline])

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current!
    const r = c.getBoundingClientRect()
    const labelW = 56
    const hitX = labelW + (r.width - labelW) * HIT_X
    const pxPerSec = (r.width - hitX) / (lookAhead * lastRate.current)
    onSeek(Math.max(0, lastPos.current + (e.clientX - r.left - hitX) / pxPerSec))
  }

  return <canvas ref={canvasRef} className="highway" onPointerDown={onPointerDown} aria-label="Línea de tiempo simplificada" />
}

function lowerBound(evs: DrumEvent[], t: number) {
  let lo = 0
  let hi = evs.length
  while (lo < hi) {
    const m = (lo + hi) >> 1
    if (evs[m].time < t) lo = m + 1
    else hi = m
  }
  return lo
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}
