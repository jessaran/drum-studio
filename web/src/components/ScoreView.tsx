import * as alphaTab from '@coderline/alphatab'
import { useEffect, useMemo, useRef, useState } from 'react'
import { scoreToAlphaTex } from '../core/alphaTex'
import { INSTRUMENTS } from '../core/instruments'
import { buildScoreModel, type ScoreModel } from '../core/scoreModel'
import { barIndexAtTime, computeBars, secondsToTick } from '../core/timeline'
import type { DrumEvent, Song } from '../core/types'
import type { FrameSource } from '../engine/visualLoop'

/**
 * Partitura de batería con alphaTab (solo renderizado).
 *
 * El reproductor de alphaTab está desactivado: el cursor, el resaltado y el
 * desplazamiento se calculan aquí con la posición del reloj único de la app.
 * La partitura se genera desde los eventos cuantizados (ver scoreModel.ts),
 * por eso refleja al instante las ediciones manuales.
 */

interface Props {
  song: Song
  events: DrumEvent[]
  frames: FrameSource
  scale: number
  dark: boolean
  loop: { start: number; end: number } | null
  onSeekBar: (bar: number) => void
}

interface BeatIndex {
  /** x relativo al host, en píxeles. */
  x: number
  tick: number
  bounds: { x: number; y: number; w: number; h: number }
}

export function ScoreView({ song, events, frames, scale, dark, loop, onSeekBar }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const cursorRef = useRef<HTMLDivElement>(null)
  const hlRef = useRef<HTMLDivElement>(null)
  const loopRef = useRef<HTMLDivElement>(null)
  const apiRef = useRef<alphaTab.AlphaTabApi | null>(null)
  const indexRef = useRef<{ beats: BeatIndex[]; byEvent: Map<string, BeatIndex[]>; bars: { index: number; x: number; w: number; y: number; h: number }[] }>({ beats: [], byEvent: new Map(), bars: [] })
  const followRef = useRef(true)
  const [rendering, setRendering] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const model: ScoreModel = useMemo(() => {
    const durationTicks = secondsToTick(song.timeline, song.duration)
    return buildScoreModel(song.timeline, events, durationTicks, song.pedalRole)
  }, [song.timeline, song.duration, song.pedalRole, events])

  const eventTimes = useMemo(() => [...events].sort((a, b) => a.time - b.time), [events])

  // Crear la API una vez.
  useEffect(() => {
    const host = hostRef.current!
    const settings = new alphaTab.Settings()
    settings.core.useWorkers = true
    // En producción las fuentes se copian a <base>/font/ (plugin de Vite); se fija la ruta por si la app vive en una subcarpeta.
    if (import.meta.env.PROD) settings.core.fontDirectory = `${import.meta.env.BASE_URL}font/`
    settings.core.includeNoteBounds = false
    settings.display.layoutMode = alphaTab.LayoutMode.Horizontal
    settings.display.padding = [12, 4]
    settings.display.staveProfile = alphaTab.StaveProfile.Score
    settings.player.playerMode = alphaTab.PlayerMode.Disabled
    settings.player.enableCursor = false
    settings.notation.elements.set(alphaTab.NotationElement.ScoreTitle, false)
    settings.notation.elements.set(alphaTab.NotationElement.ScoreSubTitle, false)
    settings.notation.elements.set(alphaTab.NotationElement.ScoreArtist, false)
    settings.notation.elements.set(alphaTab.NotationElement.ScoreWordsAndMusic, false)
    settings.notation.elements.set(alphaTab.NotationElement.TrackNames, false)
    settings.notation.elements.set(alphaTab.NotationElement.GuitarTuning, false)
    const api = new alphaTab.AlphaTabApi(host, settings)
    apiRef.current = api
    api.renderStarted.on(() => setRendering(true))
    api.error.on((e) => setError(String(e)))
    return () => {
      api.destroy()
      apiRef.current = null
    }
  }, [])

  // Renderizar cuando cambian eventos, escala o tema.
  useEffect(() => {
    const api = apiRef.current
    if (!api) return
    const ink = dark ? '#e7e9ee' : '#1b1c1f'
    const res = api.settings.display.resources
    res.mainGlyphColor = alphaTab.model.Color.fromJson(ink)!
    res.staffLineColor = alphaTab.model.Color.fromJson(dark ? '#5d6370' : '#a5a9b1')!
    res.barSeparatorColor = alphaTab.model.Color.fromJson(dark ? '#7a808c' : '#6b6f78')!
    res.barNumberColor = alphaTab.model.Color.fromJson(dark ? '#9aa1ad' : '#7a7f88')!
    res.scoreInfoColor = alphaTab.model.Color.fromJson(ink)!
    api.settings.display.scale = scale
    api.updateSettings()

    let score: alphaTab.model.Score
    try {
      score = alphaTab.importer.ScoreLoader.loadAlphaTex(scoreToAlphaTex(model, song.title, song.artist), api.settings)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return
    }
    setError(null)
    // Cabezas de nota con el color de cada pieza (el bombo y platillos con su color de contorno para legibilidad).
    const track = score.tracks[0]
    track.staves[0].bars.forEach((bar, bi) => {
      bar.voices.forEach((voice, vi) => {
        const mBeats = model.bars[bi]?.voices[vi as 0 | 1]
        voice.beats.forEach((beat, j) => {
          const mb = mBeats?.[j]
          if (!mb) return
          beat.notes.forEach((note, k) => {
            const mn = mb.notes[k]
            if (!mn) return
            const def = INSTRUMENTS[mn.instrument]
            const color = def.id === 'kick' ? ink : def.color === '#f9cf45' ? '#d9a400' : def.stroke
            const style = new alphaTab.model.NoteStyle()
            style.colors.set(alphaTab.model.NoteSubElement.StandardNotationNoteHead, alphaTab.model.Color.fromJson(color))
            note.style = style
          })
        })
      })
    })

    const off = api.postRenderFinished.on(() => {
      const lookup = api.boundsLookup
      const beats: BeatIndex[] = []
      const byEvent = new Map<string, BeatIndex[]>()
      const bars: { index: number; x: number; w: number; y: number; h: number }[] = []
      if (lookup) {
        for (const sys of lookup.staffSystems) for (const mb of sys.bars) bars.push({ index: mb.index, x: mb.realBounds.x, w: mb.realBounds.w, y: mb.realBounds.y, h: mb.realBounds.h })
        track.staves[0].bars.forEach((bar, bi) => {
          bar.voices.forEach((voice, vi) => {
            const mBeats = model.bars[bi]?.voices[vi as 0 | 1]
            voice.beats.forEach((beat, j) => {
              const mb = mBeats?.[j]
              const b = lookup.findBeat(beat)
              if (!mb || !b) return
              const entry: BeatIndex = { x: b.onNotesX, tick: mb.startTick, bounds: { x: b.visualBounds.x, y: b.visualBounds.y, w: b.visualBounds.w, h: b.visualBounds.h } }
              beats.push(entry)
              for (const n of mb.notes) for (const id of n.eventIds) {
                const arr = byEvent.get(id)
                if (arr) arr.push(entry)
                else byEvent.set(id, [entry])
              }
            })
          })
        })
      }
      beats.sort((a, b) => a.tick - b.tick || a.x - b.x)
      indexRef.current = { beats, byEvent, bars }
      setRendering(false)
      drawLoop()
    })
    api.renderScore(score, [0])
    return () => off()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, scale, dark])

  const drawLoop = () => {
    const el = loopRef.current
    if (!el) return
    const { bars } = indexRef.current
    if (!loop || bars.length === 0) {
      el.style.display = 'none'
      return
    }
    const startBar = barAtTime(song, loop.start)
    const endBar = barAtTime(song, loop.end - 1e-6)
    const a = bars.find((b) => b.index === startBar)
    const b = bars.find((x) => x.index === endBar)
    if (!a || !b) return
    el.style.display = 'block'
    el.style.left = `${a.x}px`
    el.style.width = `${b.x + b.w - a.x}px`
    el.style.top = `${a.y}px`
    el.style.height = `${a.h}px`
  }

  useEffect(drawLoop)

  // Cursor + resaltado + desplazamiento, por frame.
  useEffect(() => {
    let lastHl = ''
    return frames.subscribe((f) => {
      const { beats, byEvent } = indexRef.current
      const cursor = cursorRef.current
      const scroller = scrollRef.current
      if (!cursor || !scroller || beats.length === 0) return
      const tick = secondsToTick(song.timeline, Math.max(0, f.pos))
      // Interpola x entre las notas/silencios vecinos (las figuras no están espaciadas linealmente).
      let i = 0
      let lo = 0
      let hi = beats.length - 1
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (beats[mid].tick <= tick) {
          i = mid
          lo = mid + 1
        } else hi = mid - 1
      }
      const a = beats[i]
      let j = i + 1
      while (j < beats.length && beats[j].tick === a.tick) j++
      const b = beats[j]
      const x = b && b.tick > a.tick ? a.x + ((b.x - a.x) * (tick - a.tick)) / (b.tick - a.tick) : a.x
      cursor.style.transform = `translate3d(${x.toFixed(1)}px, ${a.bounds.y - 8}px, 0)`
      cursor.style.height = `${Math.max(80, a.bounds.h + 16)}px`

      // Resalta las notas del último golpe sonado (si fue hace < 220 ms reales).
      const hl = hlRef.current!
      const k = lastIndexAtOrBefore(eventTimes, f.pos)
      let key = ''
      if (k >= 0 && (f.pos - eventTimes[k].time) / f.rate < 0.22) {
        const t0 = eventTimes[k].time
        const ids: string[] = []
        for (let m = k; m >= 0 && Math.abs(eventTimes[m].time - t0) < 0.003; m--) ids.push(eventTimes[m].id)
        key = ids.join(',')
        if (key !== lastHl) {
          hl.innerHTML = ''
          const seen = new Set<BeatIndex>()
          for (const id of ids) for (const bi of byEvent.get(id) ?? []) {
            if (seen.has(bi)) continue
            seen.add(bi)
            const d = document.createElement('div')
            d.className = 'score-hl'
            d.style.cssText = `left:${bi.bounds.x - 6}px;top:${bi.bounds.y - 6}px;width:${bi.bounds.w + 12}px;height:${bi.bounds.h + 12}px`
            hl.appendChild(d)
          }
        }
      } else if (lastHl) hl.innerHTML = ''
      lastHl = key

      // Mantiene visible el compás actual: el cursor a ~30 % del ancho.
      if (f.playing && followRef.current) {
        const target = x - scroller.clientWidth * 0.3
        if (Math.abs(scroller.scrollLeft - target) > 1) scroller.scrollLeft = target
      }
    })
  }, [frames, song.timeline, eventTimes])

  const onScoreClick = (e: React.MouseEvent) => {
    const host = hostRef.current
    const api = apiRef.current
    if (!host || !api?.boundsLookup) return
    const r = host.getBoundingClientRect()
    const x = e.clientX - r.left
    const bar = indexRef.current.bars.find((b) => x >= b.x && x < b.x + b.w)
    if (bar) onSeekBar(bar.index)
  }

  return (
    <div className="score-wrap">
      <div
        ref={scrollRef}
        className="score-scroll"
        onPointerDown={() => (followRef.current = false)}
        onPointerUp={() => setTimeout(() => (followRef.current = true), 1500)}
      >
        <div className="score-inner" onClick={onScoreClick}>
          <div ref={hostRef} className="score-host" />
          <div ref={loopRef} className="score-loop" />
          <div ref={hlRef} className="score-hls" />
          <div ref={cursorRef} className="score-cursor" />
        </div>
      </div>
      {rendering && <div className="score-badge">Renderizando partitura…</div>}
      {error && <div className="score-badge score-error">Error de partitura: {error}</div>}
    </div>
  )
}

function lastIndexAtOrBefore(evs: DrumEvent[], t: number): number {
  let lo = 0
  let hi = evs.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (evs[mid].time <= t) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans
}

function barAtTime(song: Song, t: number): number {
  const bars = computeBars(song.timeline, secondsToTick(song.timeline, song.duration))
  return barIndexAtTime(bars, t)
}
