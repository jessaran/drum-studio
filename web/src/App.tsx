import { Button } from '@heroui/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { DrumEditor } from './components/editor/DrumEditor'
import { DEMO_SEQUENCE, playDemoSequence } from './components/drumkit/demoSequence'
import { InteractiveDrumKit, type DrumKitHandle } from './components/drumkit/InteractiveDrumKit'
import type { KitEvent } from './components/drumkit/kitAnimator'
import { Highway } from './components/Highway'
import { DiagnosticsPanel } from './components/panels/DiagnosticsPanel'
import { ImportPanel } from './components/panels/ImportPanel'
import { LibraryPanel } from './components/panels/LibraryPanel'
import { MappingPanel } from './components/panels/MappingPanel'
import { SettingsPanel } from './components/panels/SettingsPanel'
import { SyncPanel } from './components/panels/SyncPanel'
import { TranscribePanel } from './components/panels/TranscribePanel'
import { PracticeBar } from './components/PracticeBar'
import { ScoreView } from './components/ScoreView'
import { TopBar } from './components/TopBar'
import { Icon } from './components/ui'
import { createDemoSong } from './core/demoSong'
import type { EventSource } from './core/types'
import { engine } from './engine/engine'
import { frames } from './engine/frames'
import type { FrameSource } from './engine/visualLoop'
import { useEngine, useResolvedDark } from './state/hooks'
import { useApp } from './state/store'

const SOURCE_LABEL: Record<EventSource, string> = { demo: 'demo', midi: 'MIDI', score: 'partitura', ai: 'IA', manual: 'manual' }

export default function App() {
  const dark = useResolvedDark()
  const song = useApp((s) => s.song)
  const playEvents = useApp((s) => s.playEvents)
  const settings = useApp((s) => s.settings)
  const panel = useApp((s) => s.panel)
  const setPanel = useApp((s) => s.setPanel)
  const loading = useApp((s) => s.loading)
  const error = useApp((s) => s.error)
  const setError = useApp((s) => s.setError)
  const openSong = useApp((s) => s.openSong)
  const refreshLibrary = useApp((s) => s.refreshLibrary)
  const st = useEngine()
  const kitRef = useRef<DrumKitHandle>(null)
  const countRef = useRef<HTMLDivElement>(null)
  const [editing, setEditing] = useState(false)
  const [tapSound, setTapSound] = useState(true)
  const [demoFrames, setDemoFrames] = useState<FrameSource | null>(null)

  useEffect(() => {
    void refreshLibrary()
    void openSong(createDemoSong())
  }, [openSong, refreshLibrary])

  // Cuenta previa visual.
  useEffect(
    () =>
      frames.subscribe(() => {
        const el = countRef.current
        if (!el) return
        const c = engine.countInState()
        const text = c ? String(5 - c.beatsLeft) : ''
        if (el.textContent !== text) el.textContent = text
      }),
    [],
  )

  // Atajos de teclado (iPad con teclado / escritorio).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return
      if (e.code === 'Space') {
        e.preventDefault()
        engine.toggle()
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) useApp.getState().redo()
        else useApp.getState().undo()
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void useApp.getState().save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const kitEvents: KitEvent[] = demoFrames ? DEMO_SEQUENCE : playEvents
  const animation = useMemo(() => ({ durationMs: settings.animationMs, approachSec: settings.showUpcoming ? 1.0 : 0 }), [settings.animationMs, settings.showUpcoming])

  const sourceSummary = useMemo(() => {
    const counts = new Map<EventSource, number>()
    for (const e of song?.events ?? []) counts.set(e.source, (counts.get(e.source) ?? 0) + 1)
    return [...counts.entries()].map(([s, n]) => `${n} ${SOURCE_LABEL[s]}`).join(' · ')
  }, [song])

  const runDemo = async () => {
    engine.pause()
    const src = await playDemoSequence(engine, tapSound)
    setDemoFrames(src)
    await src.done
    setDemoFrames(null)
  }

  const view = editing ? 'editor' : settings.view

  return (
    <div className="app">
      <TopBar />

      <main className="stage">
        <InteractiveDrumKit
          ref={kitRef}
          events={kitEvents}
          frames={demoFrames ?? frames}
          animation={animation}
          showLabels={settings.showLabels}
          leftHanded={settings.leftHanded}
          pedalRole={song?.pedalRole}
          onPieceHit={(id, vel) => tapSound && void engine.preview(id, vel)}
        />
        <div ref={countRef} className="countin" aria-live="polite" />
        <div className="stage-info">
          {sourceSummary && <span className="chip">Golpes: {sourceSummary}</span>}
          {!engine.hasAudio && song && <span className="chip">Sin audio · sonidos guía</span>}
          {song?.ignoredHits && song.ignoredHits.length > 0 && (
            <button type="button" className="chip cursor-pointer" style={{ color: '#ff8a1f', borderColor: '#ff8a1f' }} onClick={() => setPanel('mapping')}>
              {song.ignoredHits.length} golpes sin pieza · Asignar
            </button>
          )}
          {st.loop && <span className="chip" style={{ color: '#4fbdfa' }}>Bucle activo</span>}
          {st.stretching && <span className="chip">Ajustando tempo sin cambiar tono…</span>}
          {loading && <span className="chip">{loading}</span>}
        </div>
        <div className="absolute right-3 top-2 flex gap-2 flex-wrap justify-end">
          <Button size="sm" variant={settings.showLabels ? 'primary' : 'tertiary'} onPress={() => useApp.getState().setSettings({ showLabels: !settings.showLabels })}>
            Manos/pies
          </Button>
          <Button size="sm" variant={tapSound ? 'primary' : 'tertiary'} onPress={() => setTapSound(!tapSound)}>
            Sonido al tocar
          </Button>
          <Button size="sm" variant="tertiary" onPress={() => void runDemo()} isDisabled={!!demoFrames}>
            <Icon name="sparkles" size={16} /> Secuencia demo
          </Button>
        </div>
        {error && (
          <div className="absolute left-3 bottom-3 right-3 err flex items-center gap-2" role="alert">
            <span className="flex-1">{error}</span>
            <Button size="sm" variant="ghost" onPress={() => setError(null)}>
              Cerrar
            </Button>
          </div>
        )}
      </main>

      <section className={`bottom view-${view}`}>
        <PracticeBar editing={editing} onToggleEditor={() => setEditing(!editing)} />
        {song && editing && <DrumEditor />}
        {song && !editing && (view === 'score' || view === 'both') && (
          <ScoreView
            song={song}
            events={playEvents}
            frames={frames}
            scale={settings.scoreScale}
            dark={dark}
            loop={st.loop}
            onSeekBar={(b) => engine.seekBar(b)}
          />
        )}
        {song && !editing && (view === 'timeline' || view === 'both') && (
          <div className={view === 'both' ? 'h-[32%] min-h-[100px] flex border-t' : 'flex-1 flex min-h-0'} style={{ borderColor: 'var(--app-border)' }}>
            <Highway song={song} events={playEvents} frames={frames} dark={dark} onSeek={(t) => engine.seek(t)} />
          </div>
        )}
      </section>

      <LibraryPanel isOpen={panel === 'library'} onClose={() => setPanel('none')} />
      <ImportPanel isOpen={panel === 'import'} onClose={() => setPanel('none')} />
      <SettingsPanel isOpen={panel === 'settings'} onClose={() => setPanel('none')} />
      <DiagnosticsPanel isOpen={panel === 'diagnostics'} onClose={() => setPanel('none')} kitRef={kitRef} />
      <SyncPanel isOpen={panel === 'sync'} onClose={() => setPanel('none')} />
      <MappingPanel isOpen={panel === 'mapping'} onClose={() => setPanel('none')} />
      <TranscribePanel isOpen={panel === 'transcribe'} onClose={() => setPanel('none')} />
    </div>
  )
}
