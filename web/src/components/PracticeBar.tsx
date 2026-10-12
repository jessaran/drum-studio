import { Button } from '@heroui/react'
import { useMemo, useState } from 'react'
import { LEVEL_LABEL, type Level } from '../core/difficulty'
import { barIndexAtTime, computeBars, secondsToTick } from '../core/timeline'
import { engine } from '../engine/engine'
import { useEngine } from '../state/hooks'
import { useApp, type ViewMode } from '../state/store'
import { Icon, Seg } from './ui'

export function PracticeBar({ editing, onToggleEditor }: { editing: boolean; onToggleEditor: () => void }) {
  const song = useApp((s) => s.song)
  const settings = useApp((s) => s.settings)
  const setSettings = useApp((s) => s.setSettings)
  const levelInfo = useApp((s) => s.levelInfo)
  const st = useEngine()
  const bars = useMemo(() => (song ? computeBars(song.timeline, secondsToTick(song.timeline, song.duration)) : []), [song])
  const [from, setFrom] = useState(1)
  const [to, setTo] = useState(4)
  const total = Math.max(1, bars.filter((b) => b.startTime < (song?.duration ?? 0)).length)

  const setLoopBars = (a: number, b: number) => {
    const s = bars[Math.max(0, a - 1)]
    const e = bars[Math.min(bars.length - 1, b - 1)]
    if (!s || !e) return
    setFrom(a)
    setTo(b)
    engine.setLoop({ start: s.startTime, end: e.endTime })
  }

  const loopCurrent = () => {
    const i = barIndexAtTime(bars, engine.visualPosition())
    setLoopBars(i + 1, i + 1)
  }

  const loopBars = st.loop ? [barIndexAtTime(bars, st.loop.start) + 1, barIndexAtTime(bars, st.loop.end - 1e-6) + 1] : null

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 flex-wrap border-b" style={{ borderColor: 'var(--app-border)' }}>
      <Seg<ViewMode>
        ariaLabel="Vista"
        value={settings.view}
        onChange={(view) => setSettings({ view })}
        options={[
          { value: 'score', label: 'Partitura' },
          { value: 'timeline', label: 'Simple' },
          { value: 'both', label: 'Ambas' },
        ]}
      />
      <Button variant={editing ? 'primary' : 'tertiary'} size="sm" onPress={onToggleEditor}>
        <Icon name="edit" size={16} /> Editor
      </Button>

      <div className="flex items-center gap-1 ml-1">
        <span className="text-sm font-semibold">Bucle</span>
        <input
          className="native w-14 text-center"
          type="number"
          inputMode="numeric"
          min={1}
          max={total}
          value={loopBars ? loopBars[0] : from}
          onChange={(e) => setFrom(Math.max(1, Math.min(total, Number(e.target.value) || 1)))}
          aria-label="Compás inicial"
        />
        <span className="muted text-sm">a</span>
        <input
          className="native w-14 text-center"
          type="number"
          inputMode="numeric"
          min={1}
          max={total}
          value={loopBars ? loopBars[1] : to}
          onChange={(e) => setTo(Math.max(1, Math.min(total, Number(e.target.value) || 1)))}
          aria-label="Compás final"
        />
        {st.loop ? (
          <Button size="sm" variant="primary" onPress={() => engine.setLoop(null)}>
            <Icon name="loop" size={16} /> Quitar ({st.loopCount})
          </Button>
        ) : (
          <>
            <Button size="sm" variant="secondary" onPress={() => setLoopBars(Math.min(from, to), Math.max(from, to))}>
              <Icon name="loop" size={16} /> Repetir
            </Button>
            <Button size="sm" variant="ghost" onPress={loopCurrent} aria-label="Repetir el compás actual">
              Actual
            </Button>
          </>
        )}
      </div>

      {song && song.sections.length > 0 && (
        <select
          className="native"
          aria-label="Practicar sección"
          value={song.sections.find((x) => loopBars && loopBars[0] === x.startBar + 1 && loopBars[1] === x.endBar)?.id ?? ''}
          onChange={(e) => {
            const sec = song.sections.find((x) => x.id === e.target.value)
            if (sec) setLoopBars(sec.startBar + 1, sec.endBar)
          }}
        >
          <option value="">Sección…</option>
          {song.sections.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name} ({x.startBar + 1}–{x.endBar})
            </option>
          ))}
        </select>
      )}

      <div className="flex items-center gap-2 ml-auto">
        <select className="native" aria-label="Nivel" value={settings.level} onChange={(e) => setSettings({ level: e.target.value as Level })}>
          {(['beginner', 'intermediate', 'advanced'] as Level[]).map((l) => (
            <option key={l} value={l}>
              Nivel: {LEVEL_LABEL[l]}
            </option>
          ))}
        </select>
        {levelInfo && levelInfo.kind !== 'full' && (
          <span className="chip" title={levelInfo.description}>
            {levelInfo.kind === 'author' ? 'Variante de autor' : 'Reducción'}
          </span>
        )}
        <Button size="sm" variant="ghost" isIconOnly aria-label="Reducir partitura" onPress={() => setSettings({ scoreScale: Math.max(0.5, +(settings.scoreScale - 0.1).toFixed(2)) })}>
          −
        </Button>
        <span className="text-xs muted tabular-nums w-10 text-center">{Math.round(settings.scoreScale * 100)}%</span>
        <Button size="sm" variant="ghost" isIconOnly aria-label="Ampliar partitura" onPress={() => setSettings({ scoreScale: Math.min(1.8, +(settings.scoreScale + 0.1).toFixed(2)) })}>
          +
        </Button>
      </div>
    </div>
  )
}
