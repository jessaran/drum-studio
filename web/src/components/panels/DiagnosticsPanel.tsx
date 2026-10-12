import { Button } from '@heroui/react'
import { useState, type RefObject } from 'react'
import { engine } from '../../engine/engine'
import { frames } from '../../engine/frames'
import { useApp } from '../../state/store'
import type { DrumKitHandle } from '../drumkit/InteractiveDrumKit'
import { Sheet } from '../ui'

interface Report {
  seconds: number
  rate: number
  events: number
  litOk: number
  missed: { time: number; instrument: string }[]
  lagMean: number
  lagMax: number
  frameMean: number
  frameP95: number
  frameStd: number
  timerMean: number
  timerP95: number
  timerMax: number
  leadMin: number
  late: number
  outputLatency: number
  baseLatency: number
  usesOutputTimestamp: boolean
}

const pct = (arr: number[], p: number) => {
  if (!arr.length) return 0
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]
}
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
const std = (a: number[]) => {
  const m = mean(a)
  return Math.sqrt(mean(a.map((x) => (x - m) ** 2)))
}

/**
 * Prueba de sincronía en el dispositivo real. Reproduce un tramo y, en cada
 * frame, comprueba que las piezas iluminadas son exactamente las que tocan,
 * midiendo el retraso entre el golpe audible y el primer frame que lo muestra.
 */
export function DiagnosticsPanel({ isOpen, onClose, kitRef }: { isOpen: boolean; onClose: () => void; kitRef: RefObject<DrumKitHandle | null> }) {
  const playEvents = useApp((s) => s.playEvents)
  const [report, setReport] = useState<Report | null>(null)
  const [running, setRunning] = useState(false)
  const [seconds, setSeconds] = useState(12)

  const run = async () => {
    setRunning(true)
    setReport(null)
    engine.pause()
    engine.setLoop(null)
    const startPos = 0
    engine.seek(startPos)
    engine.resetStats()
    const frameIntervals: number[] = []
    const lags: number[] = []
    let litOk = 0
    const missed: Report['missed'] = []
    const evs = [...playEvents].sort((a, b) => a.time - b.time)
    let next = 0
    let lastNow = 0
    await engine.play()
    const unsub = frames.subscribe((f) => {
      if (!f.playing) return
      if (lastNow) frameIntervals.push(f.now - lastNow)
      lastNow = f.now
      const active = new Set(kitRef.current?.activeInstruments() ?? [])
      while (next < evs.length && evs[next].time <= f.pos) {
        const e = evs[next]
        const lag = ((f.pos - e.time) / f.rate) * 1000
        lags.push(lag)
        if (active.has(e.instrument)) litOk++
        else missed.push({ time: e.time, instrument: e.instrument })
        next++
      }
    })
    const ctx = engine.ctx!
    await new Promise((r) => setTimeout(r, seconds * 1000))
    unsub()
    engine.pause()
    const ts = typeof ctx.getOutputTimestamp === 'function' ? ctx.getOutputTimestamp() : null
    setReport({
      seconds,
      rate: engine.clock.rate,
      events: lags.length,
      litOk,
      missed: missed.slice(0, 20),
      lagMean: mean(lags),
      lagMax: Math.max(0, ...lags),
      frameMean: mean(frameIntervals),
      frameP95: pct(frameIntervals, 95),
      frameStd: std(frameIntervals),
      timerMean: mean(engine.stats.intervals),
      timerP95: pct(engine.stats.intervals, 95),
      timerMax: Math.max(0, ...engine.stats.intervals),
      leadMin: engine.stats.leads.length ? Math.min(...engine.stats.leads) : 0,
      late: engine.stats.lateCount,
      outputLatency: (ctx.outputLatency ?? 0) * 1000,
      baseLatency: (ctx.baseLatency ?? 0) * 1000,
      usesOutputTimestamp: !!ts && (ts.performanceTime ?? 0) > 0,
    })
    setRunning(false)
  }

  const r = report
  return (
    <Sheet title="Diagnóstico de sincronía" isOpen={isOpen} onClose={onClose}>
      <div className="panel-section">
        <p className="muted text-sm">
          Reproduce la canción actual desde el inicio a la velocidad actual y verifica, frame a frame, que cada golpe ilumina su pieza. Las pruebas unitarias del reloj y del scheduler están en <code>npm test</code>.
        </p>
        <div className="flex items-center gap-2">
          <select className="native" value={seconds} onChange={(e) => setSeconds(Number(e.target.value))}>
            <option value={6}>6 s</option>
            <option value={12}>12 s</option>
            <option value={30}>30 s</option>
          </select>
          <Button onPress={() => void run()} isPending={running}>
            {running ? 'Midiendo…' : 'Ejecutar prueba'}
          </Button>
        </div>
        {r && (
          <table className="data">
            <tbody>
              <tr><td>Golpes comprobados</td><td>{r.events} (velocidad {Math.round(r.rate * 100)} %)</td></tr>
              <tr>
                <td>Pieza correcta iluminada</td>
                <td style={{ color: r.litOk === r.events ? '#2f9a43' : '#ff4d4f', fontWeight: 700 }}>
                  {r.litOk}/{r.events} {r.litOk === r.events ? '✓' : '✗'}
                </td>
              </tr>
              <tr><td>Retraso visual tras el golpe (medio / máx.)</td><td>{r.lagMean.toFixed(1)} ms / {r.lagMax.toFixed(1)} ms</td></tr>
              <tr><td>Frames (media / p95 / desviación)</td><td>{r.frameMean.toFixed(1)} / {r.frameP95.toFixed(1)} / {r.frameStd.toFixed(2)} ms</td></tr>
              <tr><td>Temporizador del scheduler (media / p95 / máx.)</td><td>{r.timerMean.toFixed(1)} / {r.timerP95.toFixed(1)} / {r.timerMax.toFixed(1)} ms</td></tr>
              <tr><td>Antelación mínima de programación</td><td>{r.leadMin.toFixed(1)} ms · tardíos: {r.late}</td></tr>
              <tr><td>Latencia de salida (navegador)</td><td>output {r.outputLatency.toFixed(1)} ms · base {r.baseLatency.toFixed(1)} ms · getOutputTimestamp: {r.usesOutputTimestamp ? 'sí' : 'no'}</td></tr>
            </tbody>
          </table>
        )}
        {r && r.missed.length > 0 && (
          <div className="warn text-xs">
            No iluminados: {r.missed.map((m) => `${m.instrument}@${m.time.toFixed(3)}s`).join(', ')}
          </div>
        )}
        <p className="muted text-xs">
          Los sonidos se programan con exactitud de muestra en el reloj de audio; el retraso visual máximo esperado es un frame (~16,7 ms a 60 Hz, ~8,3 ms a 120 Hz en iPad Pro).
        </p>
      </div>
    </Sheet>
  )
}
