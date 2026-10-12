import { Button } from '@heroui/react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { barIndexAtTime, computeBars, secondsToTick } from '../core/timeline'
import { engine } from '../engine/engine'
import { frames } from '../engine/frames'
import { formatTime, useEngine } from '../state/hooks'
import { useApp } from '../state/store'
import { Icon, Range } from './ui'

const ORIGIN_LABEL: Record<string, string> = {
  demo: 'Demo',
  midi: 'MIDI',
  musicxml: 'MusicXML',
  guitarpro: 'Guitar Pro',
  audio: 'Audio',
  transcription: 'Transcripción IA',
  manual: 'Manual',
}

export function TopBar() {
  const song = useApp((s) => s.song)
  const setPanel = useApp((s) => s.setPanel)
  const dirty = useApp((s) => s.dirty)
  const save = useApp((s) => s.save)
  const st = useEngine()
  const timeRef = useRef<HTMLSpanElement>(null)
  const [speed, setSpeed] = useState<number | null>(null)
  const bars = useMemo(() => (song ? computeBars(song.timeline, secondsToTick(song.timeline, song.duration)) : []), [song])

  useEffect(() => {
    let lastText = ''
    return frames.subscribe((f) => {
      if (!timeRef.current || bars.length === 0) return
      const bar = barIndexAtTime(bars, Math.max(0, f.pos))
      const text = `c. ${bar + 1} · ${formatTime(f.pos)} / ${formatTime(st.duration)}`
      if (text !== lastText) {
        timeRef.current.textContent = text
        lastText = text
      }
    })
  }, [bars, st.duration])

  const currentBar = () => barIndexAtTime(bars, engine.visualPosition())

  return (
    <header className="topbar">
      <Button variant="ghost" className="icon-btn" isIconOnly aria-label="Biblioteca" onPress={() => setPanel('library')}>
        <Icon name="library" />
      </Button>
      <button type="button" className="text-left min-w-0 max-w-[260px] bg-transparent border-0 p-0 cursor-pointer" onClick={() => setPanel('library')}>
        <div className="font-bold truncate text-[15px]">{song?.title ?? 'Sin canción'}</div>
        <div className="muted text-xs truncate">
          {song?.artist}
          {song && <span className="chip ml-2 !py-0">{ORIGIN_LABEL[song.origin] ?? song.origin}</span>}
        </div>
      </button>
      <Button variant="secondary" size="sm" onPress={() => setPanel('import')}>
        <Icon name="import" size={18} /> Importar
      </Button>

      <div className="flex items-center gap-1 mx-auto">
        <Button variant="ghost" isIconOnly className="icon-btn" aria-label="Al inicio" onPress={() => engine.seek(st.loop?.start ?? 0)}>
          <Icon name="rewind" />
        </Button>
        <Button variant="ghost" isIconOnly className="icon-btn" aria-label="Compás anterior" onPress={() => engine.seekBar(currentBar() - 1)}>
          <Icon name="prev" />
        </Button>
        <Button
          isIconOnly
          className="!w-14 !h-14 !rounded-full"
          aria-label={st.playing ? 'Pausa' : 'Reproducir'}
          onPress={() => engine.toggle()}
          isDisabled={!song}
        >
          <Icon name={st.playing ? 'pause' : 'play'} size={26} />
        </Button>
        <Button variant="ghost" isIconOnly className="icon-btn" aria-label="Compás siguiente" onPress={() => engine.seekBar(currentBar() + 1)}>
          <Icon name="next" />
        </Button>
        <span ref={timeRef} className="time-display">
          c. 1 · 0:00.0
        </span>
      </div>

      <div className="flex items-center gap-2">
        <div className="w-[170px]">
          <Range
            label={st.stretching ? 'Velocidad (procesando…)' : 'Velocidad'}
            value={speed ?? Math.round(st.rate * 100)}
            min={50}
            max={150}
            step={5}
            format={(v) => `${v} %`}
            onChange={setSpeed}
            onChangeEnd={(v) => {
              engine.setRate(v / 100)
              setSpeed(null)
            }}
          />
        </div>
        <Button
          variant={st.metronome ? 'primary' : 'tertiary'}
          isIconOnly
          className="icon-btn"
          aria-label="Metrónomo"
          aria-pressed={st.metronome}
          onPress={() => engine.setMetronome(!st.metronome)}
        >
          <Icon name="metronome" />
        </Button>
        <Button variant={st.countIn ? 'primary' : 'tertiary'} size="sm" aria-pressed={st.countIn} onPress={() => engine.setCountIn(!st.countIn)}>
          1-2-3-4
        </Button>
        <Button variant="tertiary" isIconOnly className="icon-btn" aria-label="Volúmenes" onPress={() => setPanel('settings')}>
          <Icon name="gear" />
        </Button>
        {dirty && (
          <Button variant="secondary" size="sm" onPress={() => void save()}>
            <Icon name="save" size={18} /> Guardar
          </Button>
        )}
      </div>
    </header>
  )
}
