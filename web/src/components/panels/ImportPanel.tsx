import { Button } from '@heroui/react'
import { useMemo, useState } from 'react'
import { decodeBlob, primeStem } from '../../audio/audioLoader'
import { INSTRUMENT_IDS, INSTRUMENTS } from '../../core/instruments'
import { collectNotes, midiToEvents, parseMidi, type ParsedMidi } from '../../core/midiIO'
import { BUILTIN_MAPPINGS, noteLabel, type DrumMapping, type MappedNote } from '../../core/midiMapping'
import { DEFAULT_QUANTIZE, type QuantizeOptions } from '../../core/quantize'
import { importScoreBytes, type ImportedScore } from '../../core/scoreImport'
import { buildSong } from '../../core/songFactory'
import { createTimeline } from '../../core/timeline'
import type { Song, StemRef } from '../../core/types'
import { uid } from '../../core/uid'
import { saveBlob } from '../../state/persistence'
import { useApp } from '../../state/store'
import { Sheet, Toggle } from '../ui'

const SCORE_EXT = /\.(mid|midi|xml|musicxml|mxl|gp|gp3|gp4|gp5|gpx|gp7|alphatex|atex)$/i
const AUDIO_EXT = /\.(mp3|wav|flac|m4a|aac|ogg|oga|aiff?)$/i

/** Opciones del selector de mapeo: pieza o pieza+articulación. */
const MAP_OPTIONS: { key: string; label: string; value: MappedNote | null }[] = [
  { key: '', label: 'Ignorar', value: null },
  ...INSTRUMENT_IDS.map((id) => ({ key: id, label: INSTRUMENTS[id].label, value: { instrument: id } as MappedNote })),
  { key: 'hiHat:open', label: 'Hi-hat (abierto)', value: { instrument: 'hiHat', articulation: 'open' } },
  { key: 'ride:bell', label: 'Ride (campana)', value: { instrument: 'ride', articulation: 'bell' } },
  { key: 'snare:sidestick', label: 'Caja (aro/cross-stick)', value: { instrument: 'snare', articulation: 'sidestick' } },
  { key: 'crash:china', label: 'Crash (china)', value: { instrument: 'crash', articulation: 'china' } },
  { key: 'crash:splash', label: 'Crash (splash)', value: { instrument: 'crash', articulation: 'splash' } },
]
const keyOf = (m: MappedNote | null | undefined) => (m ? (m.articulation ? `${m.instrument}:${m.articulation}` : m.instrument) : '')

interface AudioPick {
  file: File
  buffer: AudioBuffer
}

export function ImportPanel({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const settings = useApp((s) => s.settings)
  const setSettings = useApp((s) => s.setSettings)
  const currentSong = useApp((s) => s.song)
  const openSong = useApp((s) => s.openSong)
  const setPanel = useApp((s) => s.setPanel)

  const [scoreFile, setScoreFile] = useState<File | null>(null)
  const [midi, setMidi] = useState<ParsedMidi | null>(null)
  const [tracks, setTracks] = useState<number[]>([])
  const [scoreImport, setScoreImport] = useState<ImportedScore | null>(null)
  const [audio, setAudio] = useState<AudioPick | null>(null)
  const [mapping, setMapping] = useState<DrumMapping>(() => useApp.getState().mapping())
  const [quant, setQuant] = useState<QuantizeOptions>(DEFAULT_QUANTIZE)
  const [bpm, setBpm] = useState(120)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const reset = () => {
    setScoreFile(null)
    setMidi(null)
    setScoreImport(null)
    setAudio(null)
    setErr(null)
    setTracks([])
  }

  const onScore = async (file: File) => {
    setErr(null)
    setScoreFile(file)
    setMidi(null)
    setScoreImport(null)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      if (/\.(mid|midi)$/i.test(file.name)) {
        const parsed = parseMidi(bytes, file.name)
        setMidi(parsed)
        const perc = parsed.tracks.filter((t) => t.isPercussion && t.noteCount > 0).map((t) => t.index)
        setTracks(perc.length ? perc : parsed.tracks.filter((t) => t.noteCount > 0).map((t) => t.index).slice(0, 1))
      } else {
        setScoreImport(importScoreBytes(bytes, file.name, mapping))
      }
    } catch (e) {
      setErr(`No se pudo leer «${file.name}»: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const onAudio = async (file: File) => {
    setErr(null)
    setBusy('Decodificando audio…')
    try {
      const ctx = new OfflineAudioContext(2, 44100, 44100)
      const buffer = await decodeBlob(ctx, file)
      setAudio({ file, buffer })
    } catch (e) {
      setErr(`No se pudo decodificar el audio (${file.name}). Formatos admitidos por el navegador: MP3, WAV, FLAC, AAC/M4A. ${e instanceof Error ? e.message : ''}`)
    } finally {
      setBusy(null)
    }
  }

  const notesInUse = useMemo(() => (midi ? collectNotes(midi, tracks) : {}), [midi, tracks])

  const storeAudio = async (pick: AudioPick): Promise<StemRef> => {
    const key = `audio:${uid('a')}`
    await saveBlob(key, pick.file)
    primeStem(key, pick.buffer)
    return { id: 'mix', name: pick.file.name, kind: 'mix', blobKey: key }
  }

  const create = async (mode: 'score' | 'audioOnly' | 'attach') => {
    setBusy('Creando canción…')
    setErr(null)
    try {
      let song: Song
      const audioPart = audio ? { stems: [await storeAudio(audio)], offset: 0, duration: audio.buffer.duration } : undefined
      if (mode === 'attach' && currentSong && audioPart) {
        song = { ...currentSong, id: uid('song'), audio: { stems: audioPart.stems, offset: 0 }, duration: Math.max(currentSong.duration, audioPart.duration), updatedAt: Date.now(), title: currentSong.title }
      } else if (midi) {
        const { events, unmapped } = midiToEvents(midi, tracks, mapping, quant)
        song = buildSong({
          title: midi.name,
          origin: 'midi',
          timeline: midi.timeline,
          events,
          audio: audioPart,
          notes: unmapped.length ? `Notas MIDI ignoradas (sin asignar): ${unmapped.join(', ')}` : undefined,
        })
      } else if (scoreImport) {
        song = buildSong({
          title: scoreImport.title,
          artist: scoreImport.artist,
          origin: /\.(gp\d?|gpx)$/i.test(scoreFile?.name ?? '') ? 'guitarpro' : 'musicxml',
          timeline: scoreImport.timeline,
          events: scoreImport.events,
          sections: scoreImport.sections,
          durationTicks: scoreImport.durationTicks,
          audio: audioPart,
          notes: scoreImport.warnings.join(' '),
        })
      } else if (audioPart && audio) {
        song = buildSong({
          title: audio.file.name.replace(/\.[^.]+$/, ''),
          origin: 'audio',
          timeline: createTimeline(bpm),
          events: [],
          audio: audioPart,
          notes: 'Canción solo con audio: añade golpes en el editor o usa la transcripción automática.',
        })
      } else return
      await openSong(song)
      await useApp.getState().save()
      reset()
      // Con audio + partitura conviene ajustar la sincronía.
      if (audioPart && (midi || scoreImport || mode === 'attach')) setPanel('sync')
      else if (mode === 'audioOnly') setPanel('transcribe')
      else onClose()
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const setNoteMapping = (note: number, key: string) => {
    const opt = MAP_OPTIONS.find((o) => o.key === key)!
    const next: DrumMapping = { id: 'custom', name: 'Personalizado', notes: { ...mapping.notes, [note]: opt.value } }
    setMapping(next)
    setSettings({ customMappings: [next], mappingId: 'custom' })
  }

  return (
    <Sheet title="Importar" isOpen={isOpen} onClose={onClose} wide>
      <div className="panel-section">
        <p className="muted text-sm">
          Modo A: partitura o MIDI (sin IA, funciona sin servidor). Puedes añadir el audio de la canción y ajustar la sincronía después. Modo B: solo audio → transcripción automática (requiere el servicio Python).
        </p>

        <div className="grid sm:grid-cols-2 gap-3">
          <label className="warn !bg-transparent !border-dashed cursor-pointer block" style={{ borderColor: 'var(--app-border)' }}>
            <div className="font-semibold">Partitura o MIDI</div>
            <div className="muted text-xs">.mid · MusicXML (.xml/.musicxml/.mxl) · Guitar Pro (.gp3–.gp7/.gpx)</div>
            <input type="file" className="mt-2 text-sm" accept=".mid,.midi,.xml,.musicxml,.mxl,.gp,.gp3,.gp4,.gp5,.gpx,.gp7" onChange={(e) => e.target.files?.[0] && SCORE_EXT.test(e.target.files[0].name) && void onScore(e.target.files[0])} />
            {scoreFile && <div className="text-sm mt-1">✓ {scoreFile.name}</div>}
          </label>
          <label className="warn !bg-transparent !border-dashed cursor-pointer block" style={{ borderColor: 'var(--app-border)' }}>
            <div className="font-semibold">Audio (opcional)</div>
            <div className="muted text-xs">MP3 · WAV · FLAC · M4A</div>
            <input type="file" className="mt-2 text-sm" accept="audio/*,.mp3,.wav,.flac,.m4a" onChange={(e) => e.target.files?.[0] && AUDIO_EXT.test(e.target.files[0].name) && void onAudio(e.target.files[0])} />
            {audio && (
              <div className="text-sm mt-1">
                ✓ {audio.file.name} · {audio.buffer.duration.toFixed(1)} s
              </div>
            )}
          </label>
        </div>

        {midi && (
          <>
            <h3>Pistas MIDI</h3>
            <table className="data">
              <tbody>
                {midi.tracks.map((t) => (
                  <tr key={t.index}>
                    <td>
                      <input
                        type="checkbox"
                        checked={tracks.includes(t.index)}
                        disabled={t.noteCount === 0}
                        onChange={(e) => setTracks(e.target.checked ? [...tracks, t.index] : tracks.filter((x) => x !== t.index))}
                        aria-label={`Usar pista ${t.name}`}
                      />
                    </td>
                    <td>{t.name}</td>
                    <td className="muted">canal {t.channel + 1}</td>
                    <td className="muted">{t.noteCount} notas</td>
                    <td>{t.isPercussion && <span className="chip">percusión</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h3>Mapeo de notas → piezas</h3>
            <div className="flex gap-2 items-center flex-wrap">
              <select className="native" value={BUILTIN_MAPPINGS.some((m) => m.id === mapping.id) ? mapping.id : 'custom'} onChange={(e) => {
                const m = [...BUILTIN_MAPPINGS, ...settings.customMappings].find((x) => x.id === e.target.value)
                if (m) {
                  setMapping(m)
                  setSettings({ mappingId: m.id })
                }
              }}>
                {BUILTIN_MAPPINGS.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
                {settings.customMappings.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
              <span className="muted text-xs">Cambia cualquier nota abajo; se guarda como mapeo personalizado.</span>
            </div>
            <table className="data">
              <thead>
                <tr><th>Nota</th><th>Apariciones</th><th>Pieza</th></tr>
              </thead>
              <tbody>
                {Object.entries(notesInUse).map(([n, count]) => {
                  const note = Number(n)
                  const m = mapping.notes[note]
                  return (
                    <tr key={n} style={m === undefined || m === null ? { color: '#ff8a1f' } : undefined}>
                      <td>{noteLabel(note)}</td>
                      <td>{count}</td>
                      <td>
                        <select className="native" value={keyOf(m)} onChange={(e) => setNoteMapping(note, e.target.value)} aria-label={`Pieza para la nota ${note}`}>
                          {MAP_OPTIONS.map((o) => (
                            <option key={o.key} value={o.key}>{o.label}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            <h3>Cuantización a partitura</h3>
            <div className="flex gap-4 flex-wrap items-center">
              <select className="native" value={quant.maxBinary} onChange={(e) => setQuant({ ...quant, maxBinary: Number(e.target.value) as 2 | 4 | 8 })}>
                <option value={2}>Hasta corcheas</option>
                <option value={4}>Hasta semicorcheas</option>
                <option value={8}>Hasta fusas</option>
              </select>
              <Toggle label="Detectar tresillos y seisillos" isSelected={quant.allowTriplets} onChange={(v) => setQuant({ ...quant, allowTriplets: v })} />
            </div>
            <p className="muted text-xs">
              El MIDI conserva el tiempo real de cada golpe para la reproducción; la partitura usa la versión cuantizada. Límites: una sola rejilla por pulso, sin quintillos ni grupos irregulares.
            </p>
          </>
        )}

        {scoreImport && (
          <>
            <h3>Partitura</h3>
            <div className="text-sm">
              «{scoreImport.title}» · pista de percusión: <b>{scoreImport.trackNames[scoreImport.percussionTrackIndex]}</b> · {scoreImport.events.length} golpes · {scoreImport.sections.length} secciones
            </div>
            {scoreImport.warnings.map((w) => (
              <div key={w} className="warn">{w}</div>
            ))}
          </>
        )}

        {audio && !midi && !scoreImport && (
          <>
            <h3>Solo audio</h3>
            <div className="flex items-center gap-2 text-sm">
              Tempo aproximado (para la rejilla del editor):
              <input className="native w-20" type="number" min={30} max={300} value={bpm} onChange={(e) => setBpm(Number(e.target.value) || 120)} /> BPM
            </div>
          </>
        )}

        {err && <div className="err">{err}</div>}
        {busy && <div className="muted text-sm">{busy}</div>}

        <div className="flex gap-2 flex-wrap justify-end">
          {audio && currentSong && !midi && !scoreImport && (
            <Button variant="secondary" onPress={() => void create('attach')} isDisabled={!!busy}>
              Asociar este audio a «{currentSong.title}»
            </Button>
          )}
          {audio && !midi && !scoreImport && (
            <Button variant="secondary" onPress={() => void create('audioOnly')} isDisabled={!!busy}>
              Crear canción solo con audio
            </Button>
          )}
          {(midi || scoreImport) && (
            <Button onPress={() => void create('score')} isDisabled={!!busy || (midi !== null && tracks.length === 0)}>
              {audio ? 'Crear canción con partitura y audio' : 'Crear canción'}
            </Button>
          )}
        </div>
      </div>
    </Sheet>
  )
}
