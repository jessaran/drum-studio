import { Button } from '@heroui/react'
import { useMemo, useState } from 'react'
import { MAP_OPTIONS, mappingKey, noteLabel, type DrumMapping, type MappedNote } from '../../core/midiMapping'
import { remapNotes, summarizeNotes } from '../../core/remap'
import { engine } from '../../engine/engine'
import { useApp } from '../../state/store'
import { Icon, Sheet } from '../ui'

/**
 * Reasignar notas MIDI → piezas después de importar. Cada cambio se aplica a
 * todos los golpes de esa nota (también a los que se ignoraron al importar) y
 * se puede deshacer.
 */
export function MappingPanel({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const song = useApp((s) => s.song)
  const editEvents = useApp((s) => s.editEvents)
  const undo = useApp((s) => s.undo)
  const canUndo = useApp((s) => s.history.past.length > 0)
  const setSettings = useApp((s) => s.setSettings)
  const [saved, setSaved] = useState(false)
  const notes = useMemo(() => (song ? summarizeNotes(song.events, song.ignoredHits) : []), [song])

  if (!song) return null

  const change = (note: number, key: string) => {
    const opt = MAP_OPTIONS.find((o) => o.key === key)
    if (!opt) return
    const r = remapNotes(song.timeline, song.events, song.ignoredHits ?? [], new Map([[note, opt.value]]))
    editEvents(r.events, r.ignored)
    setSaved(false)
    if (opt.value) void engine.preview(opt.value.instrument, 100, opt.value.articulation)
  }

  const listen = (note: number) => {
    const n = notes.find((x) => x.note === note)
    if (!n) return
    engine.pause()
    engine.seek(Math.max(0, n.firstTime - 0.6))
    void engine.play()
  }

  /** Guarda las asignaciones actuales como mapeo personalizado para las próximas importaciones. */
  const remember = () => {
    const base = useApp.getState().mapping()
    const next: DrumMapping = { id: 'custom', name: 'Personalizado', notes: { ...base.notes } }
    for (const n of notes) next.notes[n.note] = n.current as MappedNote | null
    setSettings({ customMappings: [next], mappingId: 'custom' })
    setSaved(true)
  }

  const unassigned = notes.filter((n) => n.current === null)

  return (
    <Sheet title="Notas MIDI → piezas de la batería" isOpen={isOpen} onClose={onClose} wide>
      <div className="panel-section">
        {notes.length === 0 ? (
          <p className="muted">Esta canción no viene de un MIDI ni de una partitura (sus golpes no tienen nota MIDI de origen). Puedes cambiar golpes concretos en el Editor.</p>
        ) : (
          <>
            <p className="muted text-sm">
              Elige qué pieza suena con cada nota del archivo. El cambio se aplica a <b>todos</b> los golpes de esa nota, en la batería, la partitura y el editor. Pulsa «Escuchar» para oír la canción desde el primer golpe de esa nota y comprobarlo.
            </p>
            {unassigned.length > 0 && (
              <div className="warn">
                {unassigned.length === 1 ? 'Hay 1 nota sin asignar' : `Hay ${unassigned.length} notas sin asignar`} ({unassigned.map((n) => n.note).join(', ')}): sus golpes no suenan ni se muestran hasta que les asignes una pieza.
              </div>
            )}
            <table className="data">
              <thead>
                <tr>
                  <th>Nota del archivo</th>
                  <th>Golpes</th>
                  <th>Pieza</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {notes.map((n) => (
                  <tr key={n.note} style={n.current === null ? { color: '#ff8a1f' } : undefined}>
                    <td>{noteLabel(n.note)}</td>
                    <td className="tabular-nums">
                      {n.count}
                      {n.mixed && n.ignored > 0 && <span className="muted text-xs"> ({n.ignored} sin asignar)</span>}
                    </td>
                    <td>
                      <select className="native" value={mappingKey(n.current)} onChange={(e) => change(n.note, e.target.value)} aria-label={`Pieza para la nota ${n.note}`}>
                        {MAP_OPTIONS.map((o) => (
                          <option key={o.key} value={o.key}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="text-right">
                      <Button size="sm" variant="tertiary" onPress={() => listen(n.note)} aria-label={`Escuchar desde el primer golpe de la nota ${n.note}`}>
                        <Icon name="play" size={14} /> Escuchar
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex gap-2 flex-wrap items-center">
              <Button size="sm" variant="secondary" onPress={undo} isDisabled={!canUndo}>
                <Icon name="undo" size={16} /> Deshacer último cambio
              </Button>
              <Button size="sm" variant="secondary" onPress={remember}>
                {saved ? '✓ Guardado para próximas importaciones' : 'Usar este mapeo en próximas importaciones'}
              </Button>
              <span className="muted text-xs">Los golpes que cambiaste a mano en el Editor no se ven afectados.</span>
            </div>
          </>
        )}
      </div>
    </Sheet>
  )
}
