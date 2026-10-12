import { Button } from '@heroui/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin from 'wavesurfer.js/plugins/regions'
import { loadStem } from '../../audio/audioLoader'
import { annotateEvents, computeBars, secondsToTick } from '../../core/timeline'
import { engine } from '../../engine/engine'
import { frames } from '../../engine/frames'
import { useResolvedDark } from '../../state/hooks'
import { useApp } from '../../state/store'
import { Range, Sheet } from '../ui'

/**
 * Ajuste manual de sincronía entre audio y partitura/MIDI:
 *  - offset: segundo del audio donde empieza el compás 1,
 *  - escala de tempo si la grabación no coincide con el BPM del archivo.
 * La forma de onda se muestra con WaveSurfer (solo visual; el audio lo
 * reproduce el motor con el reloj único).
 */
export function SyncPanel({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const song = useApp((s) => s.song)
  const patchSong = useApp((s) => s.patchSong)
  const dark = useResolvedDark()
  const waveRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WaveSurfer | null>(null)
  const regionsRef = useRef<ReturnType<typeof RegionsPlugin.create> | null>(null)
  const [clicked, setClicked] = useState<number | null>(null)
  const [zoom, setZoom] = useState(60)
  const offset = song?.audio?.offset ?? 0
  const stem = song?.audio?.stems.find((s) => s.kind === 'mix') ?? song?.audio?.stems[0]
  const bars = useMemo(() => (song ? computeBars(song.timeline, secondsToTick(song.timeline, song.duration)) : []), [song])

  useEffect(() => {
    if (!isOpen || !stem || !waveRef.current) return
    let ws: WaveSurfer | null = null
    let cancelled = false
    const ctx = engine.ctx ?? new OfflineAudioContext(2, 44100, 44100)
    void loadStem(ctx, stem).then((buf) => {
      if (cancelled || !waveRef.current) return
      const ch = buf.getChannelData(0)
      const n = Math.min(20000, ch.length)
      const block = Math.floor(ch.length / n)
      const peaks = new Float32Array(n)
      for (let i = 0; i < n; i++) {
        let m = 0
        for (let j = 0; j < block; j++) m = Math.max(m, Math.abs(ch[i * block + j]))
        peaks[i] = m
      }
      const regions = RegionsPlugin.create()
      ws = WaveSurfer.create({
        container: waveRef.current,
        height: 110,
        peaks: [peaks],
        duration: buf.duration,
        waveColor: dark ? '#5b6372' : '#b9bec8',
        progressColor: dark ? '#8c95a6' : '#80889a',
        cursorColor: '#ff8a1f',
        cursorWidth: 2,
        minPxPerSec: zoom,
        interact: true,
        plugins: [regions],
      })
      ws.on('interaction', (t) => setClicked(t))
      wsRef.current = ws
      regionsRef.current = regions
      // Las marcas necesitan la duración ya establecida.
      ws.on('ready', () => drawMarkersRef.current())
    })
    return () => {
      cancelled = true
      ws?.destroy()
      wsRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, stem?.blobKey, dark])

  useEffect(() => {
    wsRef.current?.zoom(zoom)
  }, [zoom])

  const drawMarkers = () => {
    const regions = regionsRef.current
    if (!regions) return
    regions.clearRegions()
    for (const b of bars.slice(0, 200)) {
      regions.addRegion({ start: b.startTime + offset, content: String(b.index + 1), color: 'rgba(79,189,250,0.9)', drag: false, resize: false })
    }
  }
  const drawMarkersRef = useRef(drawMarkers)
  drawMarkersRef.current = drawMarkers
  useEffect(() => {
    if (wsRef.current?.getDuration()) drawMarkers()
  })

  // Cursor sincronizado con el reloj único.
  useEffect(() => {
    if (!isOpen) return
    return frames.subscribe((f) => {
      const ws = wsRef.current
      if (ws && f.playing) ws.setTime(Math.max(0, f.pos + offset))
    })
  }, [isOpen, offset])

  if (!song) return null
  const setOffset = (o: number) => patchSong({ audio: { ...song.audio!, offset: Math.round(o * 1000) / 1000 } })

  const scaleTempo = (factor: number) => {
    // Multiplica el tempo: el tiempo de cada golpe se divide por el mismo factor.
    const timeline = { ...song.timeline, tempos: song.timeline.tempos.map((t) => ({ ...t, bpm: t.bpm * factor })) }
    const events = annotateEvents(timeline, song.events.map((e) => ({ ...e, time: e.time / factor })))
    patchSong({ timeline })
    useApp.getState().editEvents(events)
  }

  return (
    <Sheet title="Sincronía audio ↔ partitura" isOpen={isOpen} onClose={onClose} wide>
      <div className="panel-section">
        {!song.audio && <p className="muted">Esta canción no tiene audio asociado. Usa Importar → Audio → «Asociar este audio».</p>}
        {song.audio && (
          <>
            <p className="muted text-sm">
              Las marcas azules son los compases de la partitura colocados sobre el audio. Toca la forma de onda donde suena el primer tiempo del compás 1 y pulsa «Fijar compás 1 aquí»; luego afina con los botones mientras escuchas con el metrónomo.
            </p>
            <div ref={waveRef} style={{ borderRadius: 10, overflow: 'hidden', background: 'var(--app-panel-2)' }} />
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm muted">Zoom</span>
              <input type="range" min={10} max={400} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
              {clicked !== null && (
                <>
                  <span className="chip">Marcado: {clicked.toFixed(3)} s</span>
                  <Button size="sm" onPress={() => setOffset(clicked)}>
                    Fijar compás 1 aquí
                  </Button>
                  <Button size="sm" variant="secondary" onPress={() => engine.seek(clicked - offset)}>
                    Reproducir desde aquí
                  </Button>
                </>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <b className="text-sm">Offset: {offset.toFixed(3)} s</b>
              {[-0.1, -0.01, -0.001, 0.001, 0.01, 0.1].map((d) => (
                <Button key={d} size="sm" variant="tertiary" onPress={() => setOffset(offset + d)}>
                  {d > 0 ? '+' : '−'}
                  {Math.abs(d) * 1000} ms
                </Button>
              ))}
            </div>
            <Range label="Offset (s)" value={offset} min={-10} max={30} step={0.005} onChange={setOffset} format={(v) => `${v.toFixed(3)} s`} />
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm">Tempo de la partitura: {song.timeline.tempos[0].bpm.toFixed(2)} BPM</span>
              <Button size="sm" variant="tertiary" onPress={() => scaleTempo(0.995)}>−0,5 %</Button>
              <Button size="sm" variant="tertiary" onPress={() => scaleTempo(1.005)}>+0,5 %</Button>
              <span className="muted text-xs">Si la grabación se desplaza poco a poco respecto a las marcas, ajusta el tempo.</span>
            </div>
            <p className="muted text-xs">
              Límite: se admite un desfase fijo y una escala de tempo global. Las grabaciones sin claqueta con tempo variable necesitan un mapa de tempo (pendiente: alineación automática por compás).
            </p>
          </>
        )}
      </div>
    </Sheet>
  )
}
