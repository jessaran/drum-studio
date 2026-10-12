import { useEffect, useMemo, useRef } from 'react'
import type { Peaks } from '../../core/alignment'
import { INSTRUMENTS, INSTRUMENT_IDS, type InstrumentId } from '../../core/instruments'
import { computeBars, secondsToTick } from '../../core/timeline'
import type { DrumEvent, Song } from '../../core/types'
import { frames } from '../../engine/frames'

/**
 * Dos pistas sobre el mismo eje de tiempo de la partitura:
 *   arriba  · golpes del MIDI/partitura (con líneas de compás)
 *   abajo   · forma de onda del audio, desplazada por el offset
 *
 * - Arrastrar la forma de onda la mueve respecto al MIDI (cambia el offset).
 * - Arrastrar en la pista MIDI o en la regla desplaza la vista.
 * - Pellizco / Ctrl+rueda / slider: zoom desde la canción entera hasta ~0,5 ms por píxel.
 * - Tocar sin arrastrar coloca el cursor (y la reproducción) en ese punto.
 */

export interface AlignerView {
  /** Tiempo de partitura en el borde izquierdo (s). */
  start: number
  /** Píxeles por segundo. */
  pps: number
}

interface Props {
  song: Song
  events: DrumEvent[]
  peaks: Peaks | null
  offset: number
  view: AlignerView
  onView: (v: AlignerView) => void
  /** Durante el arrastre (vista previa) y al soltar (commit=true). */
  onOffset: (offset: number, commit: boolean) => void
  onSeek: (songTime: number) => void
  dark: boolean
  guides: boolean
}

const RULER_H = 22
const MIDI_H = 108
const GAP = 6
export const MIN_PPS = 4
export const MAX_PPS = 2000

const LANES: InstrumentId[] = [...INSTRUMENT_IDS].sort((a, b) => INSTRUMENTS[a].lane - INSTRUMENTS[b].lane)
const GUIDE_INST = new Set<InstrumentId>(['kick', 'snare'])

export function AudioAligner({ song, events, peaks, offset, view, onView, onOffset, onSeek, dark, guides }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const bars = useMemo(() => computeBars(song.timeline, secondsToTick(song.timeline, song.duration)), [song.timeline, song.duration])
  const sorted = useMemo(() => [...events].sort((a, b) => a.time - b.time), [events])
  // Valores vivos para el bucle de dibujo y los gestos (sin re-render por frame).
  const live = useRef({ view, offset, peaks, sorted, bars, dark, guides, playPos: 0, playing: false })
  live.current = { ...live.current, view, offset, peaks, sorted, bars, dark, guides }

  // ---------- dibujo ----------
  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    const draw = () => {
      const { view, offset, peaks, sorted, bars, dark, guides, playPos } = live.current
      const dpr = window.devicePixelRatio || 1
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr)
        canvas.height = Math.round(h * dpr)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      const xOf = (t: number) => (t - view.start) * view.pps
      const t1 = view.start + w / view.pps
      const midiTop = RULER_H
      const waveTop = RULER_H + MIDI_H + GAP
      const waveH = h - waveTop
      const ink = dark ? '#e7e9ee' : '#1b1c1f'
      const faint = dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)'

      // Fondos de las pistas
      ctx.fillStyle = dark ? '#1b1f27' : '#f3f4f7'
      ctx.fillRect(0, midiTop, w, MIDI_H)
      ctx.fillStyle = dark ? '#141821' : '#eef0f4'
      ctx.fillRect(0, waveTop, w, waveH)

      // Compases y pulsos (en ambas pistas)
      ctx.font = '600 11px ui-sans-serif, system-ui, -apple-system'
      ctx.textBaseline = 'middle'
      for (const b of bars) {
        if (b.endTime < view.start) continue
        if (b.startTime > t1) break
        for (let k = 0; k < b.num; k++) {
          const t = b.startTime + ((b.endTime - b.startTime) * k) / b.num
          const x = xOf(t)
          ctx.fillStyle = k === 0 ? (dark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.35)') : faint
          ctx.fillRect(Math.round(x), RULER_H, k === 0 ? 1.5 : 1, h - RULER_H)
          if (k === 0) {
            ctx.fillStyle = ink
            ctx.fillText(String(b.index + 1), x + 4, RULER_H / 2)
          }
        }
      }
      // Escala de tiempo fina cuando hay mucho zoom (marcas cada 10 ms / 1 ms).
      if (view.pps >= 400) {
        const step = view.pps >= 1500 ? 0.001 : 0.01
        ctx.fillStyle = faint
        for (let t = Math.ceil(view.start / step) * step; t < t1; t += step) ctx.fillRect(Math.round(xOf(t)), RULER_H - 6, 1, 6)
      }

      // Golpes MIDI: una fila fina por pieza
      const laneH = MIDI_H / LANES.length
      const bw = Math.max(2, Math.min(10, view.pps * 0.012))
      let i = lowerBound(sorted, view.start - 0.05)
      for (; i < sorted.length && sorted[i].time <= t1 + 0.05; i++) {
        const e = sorted[i]
        const lane = LANES.indexOf(e.instrument)
        const x = xOf(e.time)
        const def = INSTRUMENTS[e.instrument]
        ctx.fillStyle = e.instrument === 'kick' ? (dark ? '#d0d5dd' : '#2a2a2a') : def.color
        ctx.globalAlpha = 0.5 + 0.5 * (e.velocity / 127)
        ctx.fillRect(x - bw / 2, midiTop + lane * laneH + 1, bw, laneH - 2)
        ctx.globalAlpha = 1
        // Líneas guía de bombo y caja hacia la forma de onda
        if (guides && GUIDE_INST.has(e.instrument)) {
          ctx.fillStyle = e.instrument === 'kick' ? (dark ? 'rgba(208,213,221,0.55)' : 'rgba(40,40,40,0.45)') : 'rgba(255,154,43,0.6)'
          ctx.fillRect(Math.round(x), waveTop, 1, waveH)
        }
      }

      // Forma de onda (desplazada por el offset): en x se dibuja el audio en (t + offset)
      if (peaks) {
        const mid = waveTop + waveH / 2
        const amp = waveH * 0.46
        const sr = peaks.sampleRate
        const spp = sr / view.pps // muestras por píxel
        ctx.fillStyle = dark ? '#8fa3c2' : '#5c6f8f'
        for (let px = 0; px < w; px++) {
          const a0 = (view.start + px / view.pps + offset) * sr
          const a1 = a0 + spp
          if (a1 < 0 || a0 >= peaks.mono.length) continue
          let lo = 0
          let hi = 0
          if (spp > peaks.block * 2) {
            const b0 = Math.max(0, Math.floor(a0 / peaks.block))
            const b1 = Math.min(peaks.min.length, Math.ceil(a1 / peaks.block))
            for (let b = b0; b < b1; b++) {
              if (peaks.min[b] < lo) lo = peaks.min[b]
              if (peaks.max[b] > hi) hi = peaks.max[b]
            }
          } else {
            const s0 = Math.max(0, Math.floor(a0))
            const s1 = Math.min(peaks.mono.length, Math.max(s0 + 1, Math.ceil(a1)))
            for (let s = s0; s < s1; s++) {
              const v = peaks.mono[s]
              if (v < lo) lo = v
              if (v > hi) hi = v
            }
          }
          const y0 = mid - hi * amp
          const y1 = mid - lo * amp
          ctx.fillRect(px, y0, 1, Math.max(1, y1 - y0))
        }
        // Inicio del archivo de audio (si es visible)
        const xStart = xOf(-offset)
        if (xStart >= 0 && xStart <= w) {
          ctx.fillStyle = '#4fbdfa'
          ctx.fillRect(xStart - 1, waveTop, 2, waveH)
          ctx.fillText('inicio del audio', xStart + 4, waveTop + 10)
        }
      } else {
        ctx.fillStyle = dark ? '#9ba2ae' : '#6b7079'
        ctx.fillText('Cargando forma de onda…', 12, waveTop + waveH / 2)
      }

      // Etiquetas de pista
      ctx.fillStyle = dark ? 'rgba(20,23,29,0.85)' : 'rgba(255,255,255,0.85)'
      ctx.fillRect(4, midiTop + 4, 52, 18)
      ctx.fillRect(4, waveTop + 4, 52, 18)
      ctx.fillStyle = ink
      ctx.fillText('MIDI', 10, midiTop + 13)
      ctx.fillText('Audio ↔', 10, waveTop + 13)

      // Cursor de reproducción
      const px = xOf(playPos)
      if (px >= 0 && px <= w) {
        ctx.fillStyle = '#ff8a1f'
        ctx.fillRect(px - 1, 0, 2, h)
      }
    }
    return frames.subscribe((f) => {
      live.current.playPos = f.pos
      live.current.playing = f.playing
      // Sigue al cursor si se sale de la vista durante la reproducción.
      const { view } = live.current
      const w = canvas.clientWidth
      if (f.playing && (f.pos < view.start || f.pos > view.start + (w * 0.9) / view.pps)) {
        onViewRef.current({ ...view, start: f.pos - (w * 0.1) / view.pps })
      }
      draw()
    })
  }, [])

  const onViewRef = useRef(onView)
  onViewRef.current = onView
  const onOffsetRef = useRef(onOffset)
  onOffsetRef.current = onOffset

  // ---------- gestos ----------
  const gesture = useRef<{
    pointers: Map<number, { x: number; y: number }>
    mode: 'audio' | 'pan' | 'pinch' | null
    startX: number
    startView: AlignerView
    startOffset: number
    /** Último desfase del arrastre (no depende de que React haya re-renderizado). */
    dragOffset: number
    moved: boolean
    pinchDist: number
    pinchCenterT: number
  }>({ pointers: new Map(), mode: null, startX: 0, startView: view, startOffset: offset, dragOffset: offset, moved: false, pinchDist: 0, pinchCenterT: 0 })

  const localX = (clientX: number) => clientX - canvasRef.current!.getBoundingClientRect().left
  const localY = (clientY: number) => clientY - canvasRef.current!.getBoundingClientRect().top

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const g = gesture.current
    try {
      canvasRef.current!.setPointerCapture(e.pointerId)
    } catch {
      /* puntero no capturable (p. ej. sintético): el gesto funciona igual dentro del canvas */
    }
    g.pointers.set(e.pointerId, { x: localX(e.clientX), y: localY(e.clientY) })
    const { view, offset } = live.current
    if (g.pointers.size === 2) {
      const [a, b] = [...g.pointers.values()]
      g.mode = 'pinch'
      g.pinchDist = Math.abs(a.x - b.x) || 1
      g.pinchCenterT = view.start + (a.x + b.x) / 2 / view.pps
      g.startView = view
      return
    }
    const y = localY(e.clientY)
    g.mode = y > RULER_H + MIDI_H ? 'audio' : 'pan'
    g.startX = localX(e.clientX)
    g.startView = view
    g.startOffset = offset
    g.dragOffset = offset
    g.moved = false
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const g = gesture.current
    if (!g.pointers.has(e.pointerId)) return
    g.pointers.set(e.pointerId, { x: localX(e.clientX), y: localY(e.clientY) })
    if (g.mode === 'pinch' && g.pointers.size >= 2) {
      const [a, b] = [...g.pointers.values()]
      const dist = Math.abs(a.x - b.x) || 1
      const pps = clamp(g.startView.pps * (dist / g.pinchDist), MIN_PPS, MAX_PPS)
      const cx = (a.x + b.x) / 2
      onViewRef.current({ pps, start: g.pinchCenterT - cx / pps })
      return
    }
    const dx = localX(e.clientX) - g.startX
    if (!g.moved && Math.abs(dx) < 4) return
    g.moved = true
    if (g.mode === 'audio') {
      // Mover la onda a la derecha = el audio llega más tarde = offset menor.
      g.dragOffset = g.startOffset - dx / g.startView.pps
      live.current.offset = g.dragOffset
      onOffsetRef.current(g.dragOffset, false)
    } else if (g.mode === 'pan') {
      onViewRef.current({ ...g.startView, start: g.startView.start - dx / g.startView.pps })
    }
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const g = gesture.current
    g.pointers.delete(e.pointerId)
    if (g.mode === 'pinch') {
      if (g.pointers.size === 0) g.mode = null
      return
    }
    if (g.mode === 'audio' && g.moved) onOffsetRef.current(g.dragOffset, true)
    if (!g.moved && g.mode) onSeek(live.current.view.start + localX(e.clientX) / live.current.view.pps)
    g.mode = null
  }

  // Rueda / pellizco de trackpad: listener no pasivo para evitar que el navegador haga zoom de la página.
  useEffect(() => {
    const canvas = canvasRef.current!
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const { view } = live.current
      if (e.ctrlKey || e.metaKey) {
        const x = e.clientX - canvas.getBoundingClientRect().left
        const t = view.start + x / view.pps
        const pps = clamp(view.pps * Math.exp(-e.deltaY * 0.01), MIN_PPS, MAX_PPS)
        onViewRef.current({ pps, start: t - x / pps })
      } else {
        const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
        onViewRef.current({ ...view, start: view.start + d / view.pps })
      }
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="block w-full rounded-xl"
      style={{ height: 300, touchAction: 'none', cursor: 'grab' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      aria-label="Alineación de audio y MIDI: arrastra la forma de onda para moverla"
    />
  )
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

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
