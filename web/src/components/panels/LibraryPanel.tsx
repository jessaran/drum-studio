import { Button } from '@heroui/react'
import { useState } from 'react'
import { decodeBlob, primeStem } from '../../audio/audioLoader'
import { createDemoSong } from '../../core/demoSong'
import { midiToEvents, parseMidi } from '../../core/midiIO'
import { importScoreBytes } from '../../core/scoreImport'
import { buildSong } from '../../core/songFactory'
import { uid } from '../../core/uid'
import { deleteSong, loadSongById, saveBlob } from '../../state/persistence'
import { useApp } from '../../state/store'
import { Icon, Sheet } from '../ui'

/** Las muestras se sirven bajo la ruta base (GitHub Pages publica en /<repo>/). */
const SAMPLES = `${import.meta.env.BASE_URL}samples/`

export function LibraryPanel({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const library = useApp((s) => s.library)
  const song = useApp((s) => s.song)
  const openSong = useApp((s) => s.openSong)
  const refresh = useApp((s) => s.refreshLibrary)
  const save = useApp((s) => s.save)
  const setPanel = useApp((s) => s.setPanel)

  const [busy, setBusy] = useState<string | null>(null)

  /** Carga una muestra de public/samples por el mismo camino que una importación manual. */
  const loadSample = async (scoreUrl: string, audioUrl?: string) => {
    setBusy('Cargando muestra…')
    try {
      const bytes = new Uint8Array(await (await fetch(scoreUrl)).arrayBuffer())
      const name = scoreUrl.split('/').pop()!
      let audio: { stems: { id: string; name: string; kind: 'mix'; blobKey: string }[]; offset: number; duration: number } | undefined
      if (audioUrl) {
        const blob = await (await fetch(audioUrl)).blob()
        const buffer = await decodeBlob(new OfflineAudioContext(2, 44100, 44100), blob)
        const key = `audio:${uid('a')}`
        await saveBlob(key, blob)
        primeStem(key, buffer)
        audio = { stems: [{ id: 'mix', name: audioUrl.split('/').pop()!, kind: 'mix', blobKey: key }], offset: 0, duration: buffer.duration }
      }
      let song
      if (/\.mid$/.test(name)) {
        const parsed = parseMidi(bytes, name)
        const perc = parsed.tracks.filter((t) => t.isPercussion).map((t) => t.index)
        const { events, unmapped, ignored } = midiToEvents(parsed, perc, useApp.getState().mapping())
        song = buildSong({ title: parsed.name, origin: 'midi', timeline: parsed.timeline, events, ignoredHits: ignored, audio, notes: unmapped.length ? `Notas MIDI ignoradas (sin asignar): ${unmapped.join(', ')}` : undefined })
      } else {
        const imp = importScoreBytes(bytes, name, useApp.getState().mapping())
        song = buildSong({ title: imp.title, artist: imp.artist, origin: 'musicxml', timeline: imp.timeline, events: imp.events, ignoredHits: imp.ignored, sections: imp.sections, durationTicks: imp.durationTicks, audio })
      }
      await openSong(song)
      await save()
      if (audio) setPanel('sync')
      else onClose()
    } finally {
      setBusy(null)
    }
  }

  const open = async (id: string) => {
    const s = await loadSongById(id)
    if (s) await openSong(s)
    onClose()
  }

  return (
    <Sheet title="Biblioteca" isOpen={isOpen} onClose={onClose}>
      <div className="panel-section">
        <h3>Demostración</h3>
        <button type="button" className="chip cursor-pointer !text-sm !py-2 justify-start" onClick={() => void openSong(createDemoSong()).then(onClose)}>
          ▶ Primer Groove · 100 BPM · 16 compases (audio sintetizado y alineado)
        </button>
        <h3>Muestras para probar la importación</h3>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" variant="secondary" isDisabled={!!busy} onPress={() => void loadSample(SAMPLES + 'funk-groove.mid')}>
            MIDI nuevo (funk humanizado)
          </Button>
          <Button size="sm" variant="secondary" isDisabled={!!busy} onPress={() => void loadSample(SAMPLES + 'funk-groove.mid', SAMPLES + 'funk-groove-audio.wav')}>
            MIDI + audio (desfasado 1,5 s)
          </Button>
          <Button size="sm" variant="secondary" isDisabled={!!busy} onPress={() => void loadSample(SAMPLES + 'primer-groove.musicxml')}>
            MusicXML
          </Button>
        </div>
        {busy && <div className="muted text-sm">{busy}</div>}
        <h3>Mis canciones</h3>
        {library.length === 0 && <p className="muted text-sm">Aún no hay canciones guardadas. Importa un MIDI, una partitura o un audio.</p>}
        <table className="data">
          <tbody>
            {library.map((m) => (
              <tr key={m.id}>
                <td>
                  <button type="button" className="font-semibold text-left bg-transparent border-0 cursor-pointer p-0" onClick={() => void open(m.id)}>
                    {m.title}
                  </button>
                  <div className="muted text-xs">
                    {m.artist} · {m.origin} · {new Date(m.updatedAt).toLocaleString()}
                  </div>
                </td>
                <td className="text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    isIconOnly
                    aria-label={`Eliminar ${m.title}`}
                    onPress={async () => {
                      if (!confirm(`¿Eliminar «${m.title}» y su audio guardado?`)) return
                      const s = await loadSongById(m.id)
                      if (s) await deleteSong(s)
                      await refresh()
                    }}
                  >
                    <Icon name="trash" size={16} />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex gap-2 flex-wrap">
          {song && song.origin !== 'demo' && (
            <Button size="sm" variant="secondary" onPress={() => void save()}>
              <Icon name="save" size={16} /> Guardar canción actual
            </Button>
          )}
          <Button size="sm" variant="secondary" onPress={() => setPanel('import')}>
            <Icon name="import" size={16} /> Importar…
          </Button>
          <Button size="sm" variant="secondary" onPress={() => setPanel('transcribe')}>
            <Icon name="sparkles" size={16} /> Transcribir audio…
          </Button>
        </div>
        <p className="muted text-xs">Las canciones y sus audios se guardan solo en este dispositivo (IndexedDB del navegador).</p>
      </div>
    </Sheet>
  )
}
