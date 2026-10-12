import { Button, ProgressBar } from '@heroui/react'
import { useEffect, useRef, useState } from 'react'
import { decodeBlob, loadStem, primeStem } from '../../audio/audioLoader'
import { encodeWav } from '../../audio/wav'
import { isInstrumentId } from '../../core/instruments'
import { quantizeEvents } from '../../core/quantize'
import { buildSong } from '../../core/songFactory'
import { annotateEvents, createTimeline, secondsToTick } from '../../core/timeline'
import type { DrumEvent, StemRef } from '../../core/types'
import { uid } from '../../core/uid'
import { engine } from '../../engine/engine'
import { loadBlob, saveBlob } from '../../state/persistence'
import { useApp } from '../../state/store'
import { Sheet, Toggle } from '../ui'

/**
 * Modo B: transcripción automática con el servicio Python (backend/).
 * El navegador decodifica el audio y lo envía como WAV; el servicio separa la
 * batería (Demucs, si está instalado), detecta ataques, los clasifica y
 * estima el tempo. Aquí se cuantiza y se crea una canción con eventos de
 * origen "ai" y su confianza, editables en el editor.
 */

interface Health {
  ok: boolean
  version: string
  separation: boolean
  separation_model?: string
  classifier: string
}

interface JobResult {
  duration: number
  bpm: number
  downbeats: number[]
  beats: number[]
  events: { time: number; instrument: string; velocity: number; confidence: number }[]
  stems: Record<string, string> | null
  method: Record<string, string>
  warnings: string[]
}

interface Job {
  id: string
  status: 'queued' | 'running' | 'done' | 'error'
  progress: number
  stage: string
  error?: string
  result?: JobResult
}

export function TranscribePanel({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const backendUrl = useApp((s) => s.settings.backendUrl)
  const setSettings = useApp((s) => s.setSettings)
  const song = useApp((s) => s.song)
  const openSong = useApp((s) => s.openSong)
  const [health, setHealth] = useState<Health | null>(null)
  const [healthErr, setHealthErr] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [separate, setSeparate] = useState(true)
  const [job, setJob] = useState<Job | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const pollRef = useRef<number | null>(null)

  const base = backendUrl.replace(/\/$/, '')

  const check = async () => {
    setHealthErr(null)
    try {
      const r = await fetch(`${base}/health`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setHealth(await r.json())
    } catch (e) {
      setHealth(null)
      setHealthErr(`No se puede conectar con ${base} (${e instanceof Error ? e.message : e}). Arranca el servicio: cd backend && ./run.sh`)
    }
  }

  useEffect(() => {
    if (isOpen) void check()
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, base])

  const songMix = song?.audio?.stems.find((s) => s.kind === 'mix')

  const start = async () => {
    setErr(null)
    setJob(null)
    setBusy('Preparando audio…')
    try {
      const ctx = engine.ctx ?? new OfflineAudioContext(2, 44100, 44100)
      let buffer: AudioBuffer
      let name: string
      let original: Blob | null = null
      if (file) {
        buffer = await decodeBlob(ctx, file)
        name = file.name
        original = file
      } else if (song && songMix) {
        buffer = await loadStem(ctx, songMix)
        name = songMix.name
        original = (await loadBlob(songMix.blobKey)) ?? null
      } else throw new Error('Elige un archivo de audio.')
      // Se envía el audio YA decodificado por este navegador (mono, 16 bits): así el servicio analiza
      // exactamente las mismas muestras que se reproducen. Enviar el MP3 original introduce un desfase
      // de ~20 ms porque cada decodificador trata distinto el relleno del codificador MP3.
      const fd = new FormData()
      fd.append('file', encodeWav(buffer, 1), name.replace(/\.[^.]+$/, '') + '.wav')
      fd.append('separate', String(separate))
      setBusy('Enviando al servicio…')
      const r = await fetch(`${base}/transcribe`, { method: 'POST', body: fd })
      if (!r.ok) throw new Error(`El servicio respondió ${r.status}: ${await r.text()}`)
      const { job_id } = (await r.json()) as { job_id: string }
      setBusy(null)
      // Sondeo del estado del trabajo (solo UI de progreso; no interviene en la sincronía).
      pollRef.current = window.setInterval(async () => {
        try {
          const jr = await fetch(`${base}/jobs/${job_id}`)
          const j = (await jr.json()) as Job
          setJob(j)
          if (j.status === 'done' || j.status === 'error') {
            clearInterval(pollRef.current!)
            pollRef.current = null
            if (j.status === 'done' && j.result) await createFromResult(j.result, name, original, buffer)
          }
        } catch (e) {
          setErr(`Se perdió la conexión con el servicio: ${e instanceof Error ? e.message : e}`)
          clearInterval(pollRef.current!)
          pollRef.current = null
        }
      }, 1000)
    } catch (e) {
      setBusy(null)
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  const createFromResult = async (res: JobResult, name: string, original: Blob | null, buffer: AudioBuffer) => {
    setBusy('Creando canción con la transcripción…')
    // Rejilla: tempo estimado y primer tiempo fuerte como inicio del compás 1.
    const offset = res.downbeats[0] ?? res.beats[0] ?? 0
    const timeline = createTimeline(Math.round(res.bpm * 100) / 100 || 120)
    const raw: DrumEvent[] = res.events
      .filter((e) => isInstrumentId(e.instrument) && e.time - offset >= -0.05)
      .map((e) => {
        const time = Math.max(0, e.time - offset)
        const rawTick = secondsToTick(timeline, time)
        return {
          id: uid(),
          instrument: e.instrument as DrumEvent['instrument'],
          time,
          tick: Math.round(rawTick),
          rawTick,
          velocity: Math.max(1, Math.min(127, Math.round(e.velocity))),
          bar: 0,
          beat: 0,
          subdivision: 0,
          source: 'ai' as const,
          confidence: e.confidence,
        }
      })
    const { events } = quantizeEvents(timeline, raw)
    // Audio: stems si hay separación; si no, la mezcla.
    const stems: StemRef[] = []
    if (res.stems) {
      for (const [kind, url] of Object.entries(res.stems)) {
        if (kind !== 'drums' && kind !== 'backing') continue
        const blob = await (await fetch(`${base}${url}`)).blob()
        const key = `audio:${uid('a')}`
        await saveBlob(key, blob)
        stems.push({ id: kind, name: kind === 'drums' ? 'Batería (separada)' : 'Resto (separado)', kind, blobKey: key })
      }
    }
    if (stems.length === 0) {
      const key = `audio:${uid('a')}`
      await saveBlob(key, original ?? encodeWav(buffer))
      primeStem(key, buffer)
      stems.push({ id: 'mix', name, kind: 'mix', blobKey: key })
    }
    const songNew = buildSong({
      title: name.replace(/\.[^.]+$/, ''),
      origin: 'transcription',
      timeline,
      events: annotateEvents(timeline, events),
      audio: { stems, offset, duration: res.duration },
      notes: `Transcripción automática (${Object.entries(res.method).map(([k, v]) => `${k}: ${v}`).join(', ')}). No es infalible: revisa y corrige en el editor. ${res.warnings.join(' ')}`,
    })
    await openSong(songNew)
    await useApp.getState().save()
    setBusy(null)
  }

  return (
    <Sheet title="Transcripción automática (beta)" isOpen={isOpen} onClose={onClose}>
      <div className="panel-section">
        <div className="warn text-sm">
          La transcripción automática es aproximada: puede confundir piezas (sobre todo toms y platillos) o perder golpes suaves. Los golpes con confianza baja se marcan en rojo y todos pueden corregirse en el editor.
        </div>
        <label className="text-sm flex items-center gap-2">
          Servicio:
          <input className="native flex-1" value={backendUrl} onChange={(e) => setSettings({ backendUrl: e.target.value })} />
          <Button size="sm" variant="secondary" onPress={() => void check()}>
            Comprobar
          </Button>
        </label>
        {health && (
          <div className="text-sm">
            ✓ Conectado (v{health.version}) · separación: {health.separation ? `sí (${health.separation_model})` : 'no instalada — se analiza la mezcla completa'} · clasificador: {health.classifier}
          </div>
        )}
        {healthErr && <div className="err">{healthErr}</div>}

        <label className="block text-sm">
          Audio:
          <input type="file" accept="audio/*,.mp3,.wav,.flac,.m4a" className="ml-2" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        {!file && songMix && <div className="muted text-xs">Sin archivo: se usará el audio de «{song?.title}».</div>}
        <Toggle label="Separar la batería (Demucs)" description="Más preciso y permite aislar/bajar la batería, pero tarda (≈ 0,5–2× la duración en un Mac M4)." isSelected={separate && (health?.separation ?? true)} onChange={setSeparate} />
        <Button onPress={() => void start()} isDisabled={!health || !!busy || (job?.status === 'running' || job?.status === 'queued') || (!file && !songMix)}>
          Transcribir
        </Button>
        {busy && <div className="muted text-sm">{busy}</div>}
        {job && (
          <div className="grid gap-1">
            <ProgressBar aria-label="Progreso" value={Math.round(job.progress * 100)}>
              <ProgressBar.Track>
                <ProgressBar.Fill />
              </ProgressBar.Track>
            </ProgressBar>
            <div className="text-sm">
              {job.stage} · {Math.round(job.progress * 100)} %
            </div>
            {job.status === 'error' && <div className="err">Error del servicio: {job.error}</div>}
            {job.status === 'done' && job.result && (
              <div className="text-sm">
                ✓ {job.result.events.length} golpes · {job.result.bpm.toFixed(1)} BPM estimados. Canción creada y guardada.
              </div>
            )}
          </div>
        )}
        {err && <div className="err">{err}</div>}
      </div>
    </Sheet>
  )
}
