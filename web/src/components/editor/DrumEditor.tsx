import { Button } from '@heroui/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { INSTRUMENT_IDS, INSTRUMENTS, type InstrumentId } from '../../core/instruments'
import { eventsToMidi } from '../../core/midiIO'
import { scoreToMusicXml } from '../../core/musicXml'
import { buildScoreModel } from '../../core/scoreModel'
import { computeBars, secondsToTick, tickToSeconds } from '../../core/timeline'
import type { DrumEvent } from '../../core/types'
import { engine } from '../../engine/engine'
import { frames } from '../../engine/frames'
import { useResolvedDark } from '../../state/hooks'
import { useApp } from '../../state/store'
import { Icon } from '../ui'
import { addHit, moveHits, quantizeHits, removeHits, setArticulation, setVelocity } from './editOps'

/**
 * Editor visual de golpes (rejilla tipo "piano roll"). Trabaja directamente
 * sobre `song.events`: lo que se edita es exactamente lo que se reproduce, se
 * anima y se dibuja en la partitura.
 */

const GRIDS = [
  { label: '1/4', div: 1 },
  { label: '1/8', div: 2 },
  { label: '1/16', div: 4 },
  { label: '1/32', div: 8 },
  { label: '1/8 T', div: 3 },
  { label: '1/16 T', div: 6 },
]

const LANES: InstrumentId[] = [...INSTRUMENT_IDS].sort((a, b) => INSTRUMENTS[a].lane - INSTRUMENTS[b].lane)
const LABEL_W = 92

type Drag = { kind: 'move'; startX: number; startY: number; ids: Set<string>; anchorTick: number; anchorLane: number; dx: number; dLane: number; moved: boolean } | null

export function DrumEditor() {
  const song = useApp((s) => s.song)!
  const editEvents = useApp((s) => s.editEvents)
  const undo = useApp((s) => s.undo)
  const redo = useApp((s) => s.redo)
  const history = useApp((s) => s.history)
  const save = useApp((s) => s.save)
  const dirty = useApp((s) => s.dirty)
  const patchSong = useApp((s) => s.patchSong)
  const dark = useResolvedDark()
  const [gridDiv, setGridDiv] = useState(4)
  const [pxPerQuarter, setPxPerQuarter] = useState(110)
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [multi, setMulti] = useState(false)
  const [snapTime, setSnapTime] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<Drag>(null)
  const posRef = useRef(0)
  const followRef = useRef(true)
  const [, force] = useState(0)

  const tl = song.timeline
  const ppq = tl.ppq
  const gridTicks = ppq / gridDiv
  const totalTicks = Math.max(secondsToTick(tl, song.duration), ...song.events.map((e) => e.tick + ppq))
  const bars = useMemo(() => computeBars(tl, totalTicks), [tl, totalTicks])
  const contentW = (totalTicks / ppq) * pxPerQuarter + 200
  const xOfTick = (t: number) => LABEL_W + (t / ppq) * pxPerQuarter
  const tickOfX = (x: number) => ((x - LABEL_W) / pxPerQuarter) * ppq

  const selected = song.events.filter((e) => selection.has(e.id))

  // Dibujo (por frame: incluye el cursor de reproducción).
  useEffect(() => {
    const canvas = canvasRef.current!
    const scroller = scrollRef.current!
    const ctx = canvas.getContext('2d')!
    const draw = () => {
      const dpr = window.devicePixelRatio || 1
      const w = scroller.clientWidth
      const h = canvas.clientHeight
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr)
        canvas.height = Math.round(h * dpr)
      }
      const sx = scroller.scrollLeft
      ctx.setTransform(dpr, 0, 0, dpr, -sx * dpr, 0)
      ctx.clearRect(sx, 0, w, h)
      const laneH = h / LANES.length
      const t0 = tickOfX(sx)
      const t1 = tickOfX(sx + w)
      // Carriles
      for (let i = 1; i < LANES.length; i += 2) {
        ctx.fillStyle = dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)'
        ctx.fillRect(sx, i * laneH, w, laneH)
      }
      // Rejilla
      for (const b of bars) {
        if (b.endTick < t0 || b.startTick > t1) continue
        for (let t = b.startTick; t < b.endTick; t += gridTicks) {
          const x = xOfTick(t)
          const isBar = t === b.startTick
          const isBeat = (t - b.startTick) % b.beatTicks === 0
          ctx.fillStyle = isBar ? (dark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)') : isBeat ? (dark ? 'rgba(255,255,255,0.16)' : 'rgba(0,0,0,0.14)') : dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'
          ctx.fillRect(x, 0, isBar ? 2 : 1, h)
          if (isBar) {
            ctx.fillStyle = dark ? '#cfd3da' : '#444'
            ctx.font = '600 11px ui-sans-serif, system-ui'
            ctx.fillText(String(b.index + 1), x + 4, 12)
          }
        }
      }
      // Golpes
      const drag = dragRef.current
      const nw = Math.max(8, Math.min(22, (gridTicks / ppq) * pxPerQuarter * 0.8))
      for (const e of song.events) {
        if (e.tick < t0 - ppq || e.tick > t1 + ppq) continue
        let tick = e.tick
        let lane = LANES.indexOf(e.instrument)
        const isSel = selection.has(e.id)
        if (drag && drag.moved && isSel) {
          tick = Math.max(0, tick + drag.dx)
          if (drag.ids.size === 1) lane = Math.max(0, Math.min(LANES.length - 1, lane + drag.dLane))
        }
        const x = xOfTick(tick)
        const y = lane * laneH + laneH * 0.12
        const hh = laneH * 0.76
        const def = INSTRUMENTS[LANES[lane]]
        ctx.globalAlpha = 0.45 + 0.55 * (e.velocity / 127)
        ctx.fillStyle = LANES[lane] === 'kick' ? (dark ? '#d0d5dd' : '#2a2a2a') : def.color
        ctx.beginPath()
        ctx.roundRect(x - nw / 2, y, nw, hh, 4)
        ctx.fill()
        ctx.globalAlpha = 1
        if (e.source === 'ai') {
          ctx.strokeStyle = (e.confidence ?? 1) < 0.6 ? '#ff4d4f' : 'rgba(255,77,79,0.35)'
          ctx.lineWidth = 2
          ctx.stroke()
        }
        if (e.source === 'manual') {
          ctx.fillStyle = dark ? '#fff' : '#111'
          ctx.beginPath()
          ctx.arc(x, y + hh - 5, 2.5, 0, Math.PI * 2)
          ctx.fill()
        }
        if (isSel) {
          ctx.strokeStyle = dark ? '#ffffff' : '#000000'
          ctx.lineWidth = 2.5
          ctx.beginPath()
          ctx.roundRect(x - nw / 2 - 2, y - 2, nw + 4, hh + 4, 5)
          ctx.stroke()
        }
      }
      // Cursor de reproducción
      const px = xOfTick(secondsToTick(tl, Math.max(0, posRef.current)))
      ctx.fillStyle = '#ff8a1f'
      ctx.fillRect(px - 1, 0, 2, h)
      // Etiquetas fijas
      ctx.fillStyle = dark ? '#171a20' : '#ffffff'
      ctx.fillRect(sx, 0, LABEL_W, h)
      ctx.font = '600 12px ui-sans-serif, system-ui'
      ctx.textBaseline = 'middle'
      LANES.forEach((id, i) => {
        const def = INSTRUMENTS[id]
        ctx.fillStyle = id === 'kick' ? (dark ? '#d0d5dd' : '#2a2a2a') : def.color
        ctx.fillRect(sx + 6, i * laneH + laneH * 0.2, 6, laneH * 0.6)
        ctx.fillStyle = dark ? '#e3e6ea' : '#222'
        ctx.fillText(def.label, sx + 16, i * laneH + laneH / 2)
      })
      ctx.textBaseline = 'alphabetic'
    }
    const unsub = frames.subscribe((f) => {
      posRef.current = f.pos
      if (f.playing && followRef.current) {
        const px = xOfTick(secondsToTick(tl, Math.max(0, f.pos)))
        const target = px - scroller.clientWidth * 0.3
        if (Math.abs(scroller.scrollLeft - target) > 1) scroller.scrollLeft = target
      }
      draw()
    })
    return unsub
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song.events, selection, gridTicks, pxPerQuarter, dark, bars, tl])

  const hitTest = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current!
    const scroller = scrollRef.current!
    const r = canvas.getBoundingClientRect()
    const x = clientX - r.left + scroller.scrollLeft
    const y = clientY - r.top
    const laneH = r.height / LANES.length
    const lane = Math.max(0, Math.min(LANES.length - 1, Math.floor(y / laneH)))
    const tick = tickOfX(x)
    const nw = Math.max(8, Math.min(22, (gridTicks / ppq) * pxPerQuarter * 0.8))
    const tolTicks = ((nw / 2 + 6) / pxPerQuarter) * ppq
    let best: DrumEvent | null = null
    for (const e of song.events) {
      if (e.instrument !== LANES[lane]) continue
      const d = Math.abs(e.tick - tick)
      if (d <= tolTicks && (!best || d < Math.abs(best.tick - tick))) best = e
    }
    return { lane, tick, x, hit: best, inLabels: clientX - r.left < LABEL_W }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const h = hitTest(e.clientX, e.clientY)
    if (h.inLabels) {
      void engine.preview(LANES[h.lane])
      return
    }
    followRef.current = false
    if (h.hit) {
      let ids = new Set(selection)
      if (multi) {
        if (ids.has(h.hit.id)) ids.delete(h.hit.id)
        else ids.add(h.hit.id)
      } else if (!ids.has(h.hit.id)) ids = new Set([h.hit.id])
      setSelection(ids)
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
      dragRef.current = { kind: 'move', startX: e.clientX, startY: e.clientY, ids, anchorTick: h.hit.tick, anchorLane: h.lane, dx: 0, dLane: 0, moved: false }
      void engine.preview(h.hit.instrument, h.hit.velocity, h.hit.articulation)
    } else {
      // Añadir golpe en la rejilla.
      const tick = Math.max(0, Math.round(h.tick / gridTicks) * gridTicks)
      const { events, id } = addHit(tl, song.events, LANES[h.lane], tick)
      editEvents(events)
      setSelection(new Set([id]))
      void engine.preview(LANES[h.lane])
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current
    if (!d) return
    const r = canvasRef.current!.getBoundingClientRect()
    const laneH = r.height / LANES.length
    const dxPx = e.clientX - d.startX
    const dyPx = e.clientY - d.startY
    if (!d.moved && Math.hypot(dxPx, dyPx) < 6) return
    d.moved = true
    const rawDx = (dxPx / pxPerQuarter) * ppq
    const targetTick = Math.round((d.anchorTick + rawDx) / gridTicks) * gridTicks
    d.dx = targetTick - d.anchorTick
    d.dLane = Math.round(dyPx / laneH)
    force((n) => n + 1)
  }

  const onPointerUp = () => {
    const d = dragRef.current
    dragRef.current = null
    setTimeout(() => (followRef.current = true), 1200)
    if (!d || !d.moved) return
    const newInst = d.ids.size === 1 && d.dLane !== 0 ? LANES[Math.max(0, Math.min(LANES.length - 1, d.anchorLane + d.dLane))] : undefined
    if (d.dx !== 0 || newInst) editEvents(moveHits(tl, song.events, d.ids, d.dx, newInst))
  }

  const download = (data: BlobPart, name: string, type: string) => {
    const url = URL.createObjectURL(new Blob([data], { type }))
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const fileBase = song.title.replace(/[^\p{L}\p{N}\- ]/gu, '').trim() || 'drumstudio'

  const exportMidi = () => download(eventsToMidi(tl, song.events, song.title, song.pedalRole) as BlobPart, `${fileBase}.mid`, 'audio/midi')
  const exportJson = () => {
    const { audio: _audio, ...rest } = song
    void _audio
    download(JSON.stringify({ format: 'drumstudio-song', version: 1, ...rest }, null, 2), `${fileBase}.json`, 'application/json')
  }
  const exportXml = () => {
    const model = buildScoreModel(tl, song.events, secondsToTick(tl, song.duration), song.pedalRole)
    download(scoreToMusicXml(model, song.title, song.artist), `${fileBase}.musicxml`, 'application/vnd.recordare.musicxml+xml')
  }

  const ids = selection
  const firstSel = selected[0]
  const bpm = tl.tempos[0]?.bpm ?? 120
  const sig = tl.timeSigs[0] ?? { num: 4, den: 4 }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex items-center gap-2 px-3 py-2 flex-wrap text-sm border-b" style={{ borderColor: 'var(--app-border)' }}>
        <Button size="sm" variant="ghost" isIconOnly aria-label="Deshacer" isDisabled={history.past.length === 0} onPress={undo}>
          <Icon name="undo" size={18} />
        </Button>
        <Button size="sm" variant="ghost" isIconOnly aria-label="Rehacer" isDisabled={history.future.length === 0} onPress={redo}>
          <Icon name="redo" size={18} />
        </Button>
        <label className="flex items-center gap-1">
          Rejilla
          <select className="native" value={gridDiv} onChange={(e) => setGridDiv(Number(e.target.value))}>
            {GRIDS.map((g) => (
              <option key={g.div} value={g.div}>{g.label}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1">
          Zoom
          <input type="range" min={40} max={320} value={pxPerQuarter} onChange={(e) => setPxPerQuarter(Number(e.target.value))} />
        </label>
        <Button size="sm" variant={multi ? 'primary' : 'tertiary'} onPress={() => setMulti(!multi)}>
          Selección múltiple
        </Button>
        <Button size="sm" variant="tertiary" onPress={() => useApp.getState().setPanel('mapping')}>
          Notas MIDI → piezas
        </Button>
        <span className="muted">Toca vacío = añadir · toca golpe = seleccionar · arrastra = mover/cambiar pieza</span>
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1">
            BPM
            <input
              className="native w-20"
              type="number"
              min={20}
              max={400}
              step={0.5}
              defaultValue={bpm}
              key={`bpm${bpm}`}
              onBlur={(e) => {
                const v = Number(e.target.value)
                if (v >= 20 && v <= 400 && v !== bpm) patchSong({ timeline: { ...tl, tempos: [{ tick: 0, bpm: v }, ...tl.tempos.slice(1)] } })
              }}
            />
          </label>
          {(song.origin === 'transcription' || song.origin === 'audio') && (
            <span className="flex items-center gap-1" title="El tempo estimado puede confundirse por un factor (½, ¾, 2…). Corrige sin mover los golpes detectados.">
              {[
                ['×½', 0.5],
                ['×¾', 0.75],
                ['×4⁄3', 4 / 3],
                ['×2', 2],
              ].map(([label, f]) => (
                <Button key={label as string} size="sm" variant="ghost" onPress={() => patchSong({ timeline: { ...tl, tempos: tl.tempos.map((t) => ({ ...t, bpm: Math.round(t.bpm * (f as number) * 100) / 100 })) } })}>
                  {label}
                </Button>
              ))}
            </span>
          )}
          <label className="flex items-center gap-1">
            Compás
            <select
              className="native"
              value={`${sig.num}/${sig.den}`}
              onChange={(e) => {
                const [num, den] = e.target.value.split('/').map(Number)
                patchSong({ timeline: { ...tl, timeSigs: [{ tick: 0, num, den }, ...tl.timeSigs.slice(1)] } })
              }}
            >
              {['2/4', '3/4', '4/4', '5/4', '6/8', '7/8', '12/8'].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <Button size="sm" variant="secondary" onPress={() => void save()} isDisabled={!dirty}>
            <Icon name="save" size={16} /> Guardar
          </Button>
        </div>
      </div>

      {selected.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-1.5 flex-wrap text-sm border-b" style={{ borderColor: 'var(--app-border)', background: 'var(--app-panel-2)' }}>
          <b>{selected.length} seleccionado(s)</b>
          {firstSel && (
            <span className="muted">
              c.{firstSel.bar + 1} t.{firstSel.beat + 1} · {firstSel.time.toFixed(3)} s · origen: {firstSel.source}
              {firstSel.originalSource ? ` (antes ${firstSel.originalSource})` : ''}
              {firstSel.confidence !== undefined ? ` · confianza ${(firstSel.confidence * 100).toFixed(0)} %` : ''}
            </span>
          )}
          <select
            className="native"
            aria-label="Cambiar pieza"
            value={selected.every((e) => e.instrument === firstSel.instrument) ? firstSel.instrument : ''}
            onChange={(e) => {
              const inst = e.target.value as InstrumentId
              if (inst) editEvents(moveHits(tl, song.events, ids, 0, inst))
            }}
          >
            <option value="">Pieza…</option>
            {LANES.map((id) => (
              <option key={id} value={id}>{INSTRUMENTS[id].label}</option>
            ))}
          </select>
          {firstSel && (firstSel.instrument === 'hiHat' || firstSel.instrument === 'ride' || firstSel.instrument === 'snare') && (
            <select className="native" aria-label="Articulación" value={firstSel.articulation ?? ''} onChange={(e) => editEvents(setArticulation(song.events, ids, e.target.value || undefined))}>
              <option value="">Normal</option>
              {firstSel.instrument === 'hiHat' && <option value="open">Abierto</option>}
              {firstSel.instrument === 'ride' && <option value="bell">Campana</option>}
              {firstSel.instrument === 'snare' && <option value="sidestick">Aro (cross-stick)</option>}
            </select>
          )}
          <label className="flex items-center gap-1">
            Velocity
            <input
              type="range"
              min={1}
              max={127}
              defaultValue={firstSel?.velocity ?? 100}
              key={firstSel?.id}
              onPointerUp={(e) => editEvents(setVelocity(song.events, ids, Number((e.target as HTMLInputElement).value)))}
              onKeyUp={(e) => editEvents(setVelocity(song.events, ids, Number((e.target as HTMLInputElement).value)))}
            />
            <span className="tabular-nums w-8">{firstSel?.velocity}</span>
          </label>
          <Button size="sm" variant="tertiary" onPress={() => editEvents(quantizeHits(tl, song.events, ids, gridTicks, snapTime))}>
            Cuantizar a {GRIDS.find((g) => g.div === gridDiv)?.label}
          </Button>
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" checked={snapTime} onChange={(e) => setSnapTime(e.target.checked)} /> ajustar también el tiempo real
          </label>
          <Button size="sm" variant="danger" onPress={() => { editEvents(removeHits(song.events, ids)); setSelection(new Set()) }}>
            <Icon name="trash" size={16} /> Eliminar
          </Button>
          <Button size="sm" variant="ghost" onPress={() => setSelection(new Set())}>
            Deseleccionar
          </Button>
        </div>
      )}

      <div ref={scrollRef} className="relative flex-1 min-h-0 overflow-x-auto overflow-y-hidden" onScroll={() => force((n) => n + 1)}>
        <div style={{ width: contentW, height: 1 }} />
        <canvas
          ref={canvasRef}
          className="sticky left-0 top-0 block"
          style={{ width: '100%', height: 'calc(100% - 1px)', touchAction: 'pan-x' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={(e) => {
            const h = hitTest(e.clientX, e.clientY)
            engine.seek(tickToSeconds(tl, Math.max(0, h.tick)))
          }}
        />
      </div>

      <div className="flex items-center gap-2 px-3 py-1.5 text-sm flex-wrap border-t" style={{ borderColor: 'var(--app-border)' }}>
        <span className="muted">Exportar:</span>
        <Button size="sm" variant="tertiary" onPress={exportMidi}>MIDI</Button>
        <Button size="sm" variant="tertiary" onPress={exportJson}>JSON</Button>
        <Button size="sm" variant="tertiary" onPress={exportXml}>MusicXML</Button>
        <Button size="sm" variant="ghost" onPress={() => setSelection(new Set(song.events.filter((e) => e.source === 'ai' && (e.confidence ?? 1) < 0.6).map((e) => e.id)))}>
          Seleccionar dudosos (IA &lt; 60 %)
        </Button>
        <span className="muted ml-auto text-xs">Doble toque: reproducir desde ahí · punto = editado a mano · borde rojo = IA</span>
      </div>
    </div>
  )
}
