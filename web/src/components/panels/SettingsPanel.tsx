import { Button } from '@heroui/react'
import { useRef, useState } from 'react'
import { playClick } from '../../audio/drumSynth'
import { PEDAL_ROLES, type PedalRole } from '../../core/instruments'
import { engine } from '../../engine/engine'
import { useEngine } from '../../state/hooks'
import { useApp, type Theme } from '../../state/store'
import { Range, Seg, Sheet, Toggle } from '../ui'

export function SettingsPanel({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const settings = useApp((s) => s.settings)
  const setSettings = useApp((s) => s.setSettings)
  const song = useApp((s) => s.song)
  const patchSong = useApp((s) => s.patchSong)
  const setPanel = useApp((s) => s.setPanel)
  const st = useEngine()
  const v = settings.volumes
  const setVol = (k: keyof typeof v, x: number) => setSettings({ volumes: { ...v, [k]: x / 100 } })
  const stems = song?.audio?.stems ?? []
  const hasStems = stems.some((s) => s.kind === 'drums')

  return (
    <Sheet title="Ajustes" isOpen={isOpen} onClose={onClose}>
      <div className="panel-section">
        <h3>Volúmenes</h3>
        <Range label="General" value={Math.round(v.master * 100)} min={0} max={100} onChange={(x) => setVol('master', x)} format={(x) => `${x}`} />
        {stems.some((s) => s.kind === 'mix') && <Range label="Canción" value={Math.round(v.mix * 100)} min={0} max={100} onChange={(x) => setVol('mix', x)} />}
        {hasStems && (
          <>
            <Range label="Batería (stem)" value={Math.round(v.drums * 100)} min={0} max={100} onChange={(x) => setVol('drums', x)} />
            <Range label="Acompañamiento (stem)" value={Math.round(v.backing * 100)} min={0} max={100} onChange={(x) => setVol('backing', x)} />
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onPress={() => setSettings({ volumes: { ...v, drums: 0, backing: 0.85 } })}>
                Sin batería (tocar encima)
              </Button>
              <Button size="sm" variant="secondary" onPress={() => setSettings({ volumes: { ...v, drums: 0.9, backing: 0 } })}>
                Solo batería
              </Button>
              <Button size="sm" variant="ghost" onPress={() => setSettings({ volumes: { ...v, drums: 0.8, backing: 0.8 } })}>
                Restablecer
              </Button>
            </div>
          </>
        )}
        {!hasStems && stems.length > 0 && <p className="muted text-xs">Esta canción tiene un único audio mezclado: aislar o bajar la batería requiere stems (se generan con la separación del servicio de transcripción).</p>}
        <Range label="Metrónomo" value={Math.round(v.metronome * 100)} min={0} max={100} onChange={(x) => setVol('metronome', x)} />
        <Range label="Sonidos guía de batería" value={Math.round(v.guide * 100)} min={0} max={100} onChange={(x) => setVol('guide', x)} />
        <Toggle label="Sonidos guía de batería" description="Sintetiza cada golpe del archivo. Se activa solo si la canción no tiene audio." isSelected={st.guide} onChange={(on) => engine.setGuide(on)} />

        <h3>Visualización</h3>
        <Seg<Theme>
          ariaLabel="Tema"
          value={settings.theme}
          onChange={(theme) => setSettings({ theme })}
          options={[
            { value: 'system', label: 'Sistema' },
            { value: 'light', label: 'Claro' },
            { value: 'dark', label: 'Oscuro' },
          ]}
        />
        <Toggle label="Anticipar el próximo golpe" description="Un anillo se cierra sobre la pieza que hay que tocar a continuación." isSelected={settings.showUpcoming} onChange={(showUpcoming) => setSettings({ showUpcoming })} />
        <Toggle label="Etiquetas de manos y pies" description="MD/MI = mano derecha/izquierda, PD/PI = pie. Sugerencia estándar, no una digitación transcrita." isSelected={settings.showLabels} onChange={(showLabels) => setSettings({ showLabels })} />
        <Toggle label="Zurdo" isSelected={settings.leftHanded} onChange={(leftHanded) => setSettings({ leftHanded })} />
        <Range label="Duración de la animación" value={settings.animationMs} min={80} max={300} step={10} onChange={(animationMs) => setSettings({ animationMs })} format={(x) => `${x} ms`} />
        {song && (
          <label className="flex items-center gap-2 text-sm">
            Pie izquierdo (golpes «pedal»):
            <select className="native" value={song.pedalRole} onChange={(e) => patchSong({ pedalRole: e.target.value as PedalRole })}>
              {(Object.keys(PEDAL_ROLES) as PedalRole[]).map((r) => (
                <option key={r} value={r}>{PEDAL_ROLES[r].label}</option>
              ))}
            </select>
          </label>
        )}

        <h3>Calibración</h3>
        <Range
          label="Latencia visual (+ retrasa lo visual)"
          value={settings.visualLatencyMs}
          min={-200}
          max={200}
          step={5}
          onChange={(visualLatencyMs) => setSettings({ visualLatencyMs })}
          format={(x) => `${x} ms`}
        />
        <VisualCalibration />
        <TapCalibration />
        <p className="muted text-xs">
          La app ya compensa la latencia de salida que informa el navegador (getOutputTimestamp / outputLatency). Con auriculares Bluetooth suele hacer falta añadir 100–250 ms.
        </p>

        <h3>Herramientas</h3>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="secondary" onPress={() => setPanel('sync')} isDisabled={!song?.audio}>
            Sincronía audio ↔ partitura
          </Button>
          <Button size="sm" variant="secondary" onPress={() => setPanel('mapping')} isDisabled={!song}>
            Notas MIDI → piezas
          </Button>
          <Button size="sm" variant="secondary" onPress={() => setPanel('diagnostics')}>
            Diagnóstico de sincronía
          </Button>
          <Button size="sm" variant="secondary" onPress={() => setPanel('transcribe')}>
            Transcripción automática
          </Button>
        </div>
      </div>
    </Sheet>
  )
}

/** Destello + clic simultáneos: el usuario ajusta la latencia visual hasta que coincidan. */
function VisualCalibration() {
  const [running, setRunning] = useState(false)
  const dotRef = useRef<HTMLDivElement>(null)
  const start = async () => {
    const ctx = await engine.ensureContext()
    engine.pause()
    setRunning(true)
    const t0 = ctx.currentTime + 0.2
    const n = 12
    const period = 0.6
    for (let i = 0; i < n; i++) playClick(ctx, ctx.destination, t0 + i * period, true)
    const loop = () => {
      const t = engine.audibleCtxTime() - engine.visualLatencyMs / 1000 - t0
      const k = Math.floor(t / period)
      const phase = t - k * period
      if (dotRef.current) dotRef.current.style.opacity = k >= 0 && k < n && phase < 0.08 ? '1' : '0.12'
      if (t < n * period) requestAnimationFrame(loop)
      else setRunning(false)
    }
    requestAnimationFrame(loop)
  }
  return (
    <div className="flex items-center gap-3">
      <Button size="sm" variant="secondary" onPress={() => void start()} isDisabled={running}>
        Prueba destello + clic
      </Button>
      <div ref={dotRef} style={{ width: 28, height: 28, borderRadius: 14, background: 'var(--app-accent)', opacity: 0.12 }} />
      <span className="muted text-xs">Ajusta el control hasta que destello y clic coincidan.</span>
    </div>
  )
}

/** Test de toques: el usuario toca al ritmo de los clics; se mide su desfase medio (latencia de entrada + respuesta). */
function TapCalibration() {
  const setSettings = useApp((s) => s.setSettings)
  const inputLatency = useApp((s) => s.settings.inputLatencyMs)
  const [state, setState] = useState<{ running: boolean; taps: number[]; t0: number; result?: number }>({ running: false, taps: [], t0: 0 })
  const period = 0.5
  const n = 16
  const start = async () => {
    const ctx = await engine.ensureContext()
    engine.pause()
    const t0 = ctx.currentTime + 0.5
    for (let i = 0; i < n; i++) playClick(ctx, ctx.destination, t0 + i * period, i % 4 === 0)
    setState({ running: true, taps: [], t0 })
    setTimeout(() => {
      setState((s) => {
        const offs = s.taps.map((t) => {
          const rel = t - s.t0
          return (rel - Math.round(rel / period) * period) * 1000
        })
        const valid = offs.slice(2) // ignora los primeros toques
        const mean = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : undefined
        if (mean !== undefined) setSettings({ inputLatencyMs: Math.round(mean) })
        return { ...s, running: false, result: mean }
      })
    }, (n * period + 1) * 1000)
  }
  const tap = () => {
    if (!state.running) return
    setState((s) => ({ ...s, taps: [...s.taps, engine.audibleCtxTime()] }))
  }
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <Button size="sm" variant="secondary" onPress={() => void start()} isDisabled={state.running}>
        Test de toques (16 clics)
      </Button>
      <button
        type="button"
        onPointerDown={tap}
        className="chip !py-3 !px-6 cursor-pointer"
        style={state.running ? { borderColor: 'var(--app-accent)', color: 'var(--app-text)' } : undefined}
      >
        {state.running ? `¡Toca aquí! (${state.taps.length})` : 'Zona de toque'}
      </button>
      <span className="muted text-xs">
        Desfase medido: {state.result !== undefined ? `${Math.round(state.result)} ms` : inputLatency ? `${inputLatency} ms (guardado)` : '—'}
      </span>
    </div>
  )
}
