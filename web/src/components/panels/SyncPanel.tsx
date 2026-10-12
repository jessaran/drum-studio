import { Button } from '@heroui/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { loadStem } from '../../audio/audioLoader'
import { autoAlign, computePeaks, toMono, type Peaks } from '../../core/alignment'
import { annotateEvents, computeBars, secondsToTick } from '../../core/timeline'
import { engine } from '../../engine/engine'
import { useEngine, useResolvedDark } from '../../state/hooks'
import { useApp } from '../../state/store'
import { AudioAligner, MAX_PPS, MIN_PPS, type AlignerView } from '../sync/AudioAligner'
import { Icon, Sheet, Toggle } from '../ui'

/**
 * Sincronía audio ↔ MIDI/partitura.
 *  - offset: segundo del audio en el que empieza la partitura (audio = partitura + offset).
 *  - escala de tempo global, para grabaciones que se desvían poco a poco.
 * Se ajusta arrastrando la forma de onda bajo los golpes del MIDI, con
 * alineación automática como punto de partida.
 */
export function SyncPanel({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const song = useApp((s) => s.song)
  const playEvents = useApp((s) => s.playEvents)
  const patchSong = useApp((s) => s.patchSong)
  const dark = useResolvedDark()
  const st = useEngine()
  const savedOffset = song?.audio?.offset ?? 0
  const [preview, setPreview] = useState<number | null>(null)
  const offset = preview ?? savedOffset
  const [peaks, setPeaks] = useState<Peaks | null>(null)
  const [view, setView] = useState<AlignerView>({ start: -0.5, pps: 60 })
  const [guides, setGuides] = useState(true)
  const [auto, setAuto] = useState<{ offset: number; confidence: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const initialOffset = useRef(savedOffset)
  const stem = song?.audio?.stems.find((s) => s.kind === 'mix') ?? song?.audio?.stems.find((s) => s.kind === 'drums') ?? song?.audio?.stems[0]
  const bars = useMemo(() => (song ? computeBars(song.timeline, secondsToTick(song.timeline, song.duration)) : []), [song])

  // Al abrir: guarda el offset inicial (para "Restablecer") y prepara la forma de onda.
  useEffect(() => {
    if (!isOpen || !stem) return
    initialOffset.current = useApp.getState().song?.audio?.offset ?? 0
    setAuto(null)
    let cancelled = false
    const ctx = engine.ctx ?? new OfflineAudioContext(2, 44100, 44100)
    void loadStem(ctx, stem).then((buf) => {
      if (cancelled) return
      const chans = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c))
      setPeaks(computePeaks(toMono(chans), buf.sampleRate))
    })
    return () => {
      cancelled = true
    }
  }, [isOpen, stem])

  if (!song) return null

  const commit = (o: number) => {
    setPreview(null)
    patchSong({ audio: { ...song.audio!, offset: Math.round(o * 1000) / 1000 } })
  }

  const runAuto = async () => {
    if (!peaks) return
    setBusy(true)
    await new Promise((r) => setTimeout(r, 30)) // deja pintar el estado "calculando"
    const dur = peaks.mono.length / peaks.sampleRate
    const r = autoAlign(peaks.mono, peaks.sampleRate, playEvents, [-Math.min(10, song.duration), Math.min(dur, 60)])
    setAuto(r)
    commit(r.offset)
    // Muestra el compás 1 con zoom para revisar.
    const first = playEvents.find((e) => e.time >= 0)?.time ?? 0
    setView({ pps: 300, start: first - 0.4 })
    setBusy(false)
  }

  const zoomTo = (pps: number, center?: number) => {
    const w = 900
    const c = center ?? view.start + w / 2 / view.pps
    const p = Math.max(MIN_PPS, Math.min(MAX_PPS, pps))
    setView({ pps: p, start: c - w / 2 / p })
  }

  const scaleTempo = (factor: number) => {
    // Multiplica el tempo: el tiempo de cada golpe se divide por el mismo factor.
    const timeline = { ...song.timeline, tempos: song.timeline.tempos.map((t) => ({ ...t, bpm: t.bpm * factor })) }
    const events = annotateEvents(timeline, song.events.map((e) => ({ ...e, time: e.time / factor })))
    patchSong({ timeline })
    useApp.getState().editEvents(events)
  }

  const ms = Math.round(offset * 1000)
  const zoomLabel = view.pps >= 1000 ? `${(1000 / view.pps).toFixed(2)} ms/px` : view.pps >= 100 ? `${(1000 / view.pps).toFixed(1)} ms/px` : `${Math.round(view.pps)} px/s`

  return (
    <Sheet title="Sincronizar audio con el MIDI" isOpen={isOpen} onClose={onClose} wide>
      <div className="panel-section">
        {!song.audio && <p className="muted">Esta canción no tiene audio. Usa Importar → Audio → «Asociar este audio».</p>}
        {song.audio && (
          <>
            <p className="muted text-sm">
              Arrastra la <b>forma de onda</b> (abajo) hasta que sus picos caigan sobre las líneas de bombo y caja. Arrastra arriba para moverte; pellizca para hacer zoom. Pulsa ▶ con «Oír el MIDI encima» para comprobarlo de oído.
            </p>

            <div className="flex items-center gap-2 flex-wrap">
              <Button size="sm" onPress={() => void runAuto()} isPending={busy} isDisabled={!peaks}>
                <Icon name="sparkles" size={16} /> Auto-alinear
              </Button>
              {auto && (
                <span className="chip" title="Fiabilidad de la alineación automática">
                  {auto.confidence > 0.5 ? 'Coincidencia clara' : auto.confidence > 0.15 ? 'Coincidencia probable: revisa' : 'Dudosa: ajusta a mano'}
                </span>
              )}
              <Button size="sm" variant={st.playing ? 'primary' : 'secondary'} isIconOnly aria-label={st.playing ? 'Pausa' : 'Reproducir'} onPress={() => engine.toggle()}>
                <Icon name={st.playing ? 'pause' : 'play'} size={18} />
              </Button>
              <Toggle label="Oír el MIDI encima" isSelected={st.guide} onChange={(on) => engine.setGuide(on)} />
              <Toggle label="Guías de bombo y caja" isSelected={guides} onChange={setGuides} />
            </div>

            <AudioAligner
              song={song}
              events={playEvents}
              peaks={peaks}
              offset={offset}
              view={view}
              onView={setView}
              onOffset={(o, isCommit) => (isCommit ? commit(o) : setPreview(o))}
              onSeek={(t) => engine.seek(t)}
              dark={dark}
              guides={guides}
            />

            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm muted">Zoom</span>
              <input
                type="range"
                aria-label="Zoom"
                min={Math.log(MIN_PPS)}
                max={Math.log(MAX_PPS)}
                step={0.01}
                value={Math.log(view.pps)}
                onChange={(e) => zoomTo(Math.exp(Number(e.target.value)))}
                className="w-48"
              />
              <span className="chip tabular-nums">{zoomLabel}</span>
              <Button size="sm" variant="tertiary" onPress={() => setView({ pps: Math.max(MIN_PPS, 880 / Math.max(1, song.duration)), start: -0.2 })}>
                Canción entera
              </Button>
              <Button size="sm" variant="tertiary" onPress={() => setView({ pps: 300, start: (bars[0]?.startTime ?? 0) - 0.4 })}>
                Compás 1
              </Button>
              <Button size="sm" variant="tertiary" onPress={() => zoomTo(1500, engine.visualPosition())}>
                Máximo zoom en el cursor
              </Button>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold">Desfase</span>
              <input
                className="native w-28 text-right tabular-nums"
                type="number"
                step={1}
                value={ms}
                aria-label="Desfase en milisegundos"
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (Number.isFinite(v)) commit(v / 1000)
                }}
              />
              <span className="text-sm muted">ms</span>
              {[-100, -10, -1, 1, 10, 100].map((d) => (
                <Button key={d} size="sm" variant="tertiary" onPress={() => commit(offset + d / 1000)} aria-label={`${d > 0 ? 'Retrasar' : 'Adelantar'} el audio ${Math.abs(d)} ms`}>
                  {d > 0 ? '+' : '−'}
                  {Math.abs(d)}
                </Button>
              ))}
              <Button size="sm" variant="ghost" onPress={() => commit(initialOffset.current)} isDisabled={Math.round(initialOffset.current * 1000) === ms}>
                Restablecer
              </Button>
            </div>
            <p className="muted text-xs">
              Desfase positivo: la partitura empieza {Math.abs(offset).toFixed(3)} s {offset >= 0 ? 'después del inicio' : 'antes del inicio'} del audio.
            </p>

            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm">Tempo: {song.timeline.tempos[0].bpm.toFixed(2)} BPM</span>
              {[0.995, 0.999, 1.001, 1.005].map((f) => (
                <Button key={f} size="sm" variant="tertiary" onPress={() => scaleTempo(f)}>
                  {f > 1 ? '+' : '−'}
                  {(Math.abs(f - 1) * 100).toFixed(1).replace('.', ',')} %
                </Button>
              ))}
              <span className="muted text-xs">Si al principio encaja y al final se separa, ajusta el tempo y vuelve a alinear el compás 1.</span>
            </div>
            <p className="muted text-xs">
              Límite: desfase fijo + escala de tempo global. Las grabaciones con tempo variable (sin claqueta) necesitan un mapa de tempo, todavía no disponible.
            </p>
          </>
        )}
      </div>
    </Sheet>
  )
}
