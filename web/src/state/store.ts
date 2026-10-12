import { create } from 'zustand'
import { loadSongStems } from '../audio/audioLoader'
import { eventsForLevel, type Level, type LevelResult } from '../core/difficulty'
import { BUILTIN_MAPPINGS, GM_MAPPING, type DrumMapping } from '../core/midiMapping'
import { assignRawTicks, quantizeEvents } from '../core/quantize'
import { annotateEvents, tickToSeconds } from '../core/timeline'
import type { DrumEvent, Song } from '../core/types'
import { engine } from '../engine/engine'
import { listSongs, loadSettings, saveSettings, saveSong, type SongMeta } from './persistence'

export type Theme = 'light' | 'dark' | 'system'
export type ViewMode = 'score' | 'timeline' | 'both'
export type Panel = 'none' | 'import' | 'editor' | 'settings' | 'diagnostics' | 'transcribe' | 'sync' | 'library'

export interface Settings {
  theme: Theme
  view: ViewMode
  level: Level
  showLabels: boolean
  leftHanded: boolean
  showUpcoming: boolean
  animationMs: number
  visualLatencyMs: number
  /** Latencia de entrada medida con el test de toques (para futuras funciones de evaluación). */
  inputLatencyMs: number
  scoreScale: number
  mappingId: string
  customMappings: DrumMapping[]
  backendUrl: string
  volumes: typeof engine.volumes
}

const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  view: 'both',
  level: 'advanced',
  showLabels: false,
  leftHanded: false,
  showUpcoming: true,
  animationMs: 150,
  visualLatencyMs: 0,
  inputLatencyMs: 0,
  scoreScale: 0.9,
  mappingId: 'gm',
  customMappings: [],
  // En producción se fija al compilar (VITE_BACKEND_URL); en local, el servicio del propio Mac.
  backendUrl: import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000',
  volumes: { ...engine.volumes },
}

interface History {
  past: DrumEvent[][]
  future: DrumEvent[][]
}

interface AppState {
  song: Song | null
  /** Eventos que se reproducen y se muestran (según nivel). */
  playEvents: DrumEvent[]
  levelInfo: LevelResult | null
  loading: string | null
  error: string | null
  library: SongMeta[]
  settings: Settings
  panel: Panel
  history: History
  dirty: boolean
  /** Ids de eventos seleccionados en el editor. */
  selection: string[]

  setPanel: (p: Panel) => void
  setError: (e: string | null) => void
  setSettings: (p: Partial<Settings>) => void
  openSong: (song: Song) => Promise<void>
  /** Sustituye la canción en memoria (p. ej. tras cambiar offset o metadatos). */
  patchSong: (p: Partial<Song>) => void
  /** Cambia los eventos registrando deshacer. */
  editEvents: (next: DrumEvent[]) => void
  undo: () => void
  redo: () => void
  save: () => Promise<void>
  refreshLibrary: () => Promise<void>
  setSelection: (ids: string[]) => void
  mapping: () => DrumMapping
}

/** Solo se aplica la carga más reciente (evita que una carga lenta pise a otra posterior). */
let loadToken = 0

function applyLevel(song: Song, level: Level) {
  const info = eventsForLevel(song, level)
  engine.setEvents(info.events)
  return info
}

export const useApp = create<AppState>((set, get) => ({
  song: null,
  playEvents: [],
  levelInfo: null,
  loading: null,
  error: null,
  library: [],
  settings: loadSettings(DEFAULT_SETTINGS),
  panel: 'none',
  history: { past: [], future: [] },
  dirty: false,
  selection: [],

  setPanel: (panel) => set({ panel }),
  setError: (error) => set({ error }),

  setSettings: (p) => {
    const settings = { ...get().settings, ...p }
    saveSettings(settings)
    set({ settings })
    if (p.volumes) engine.setVolumes(p.volumes)
    if (p.visualLatencyMs !== undefined) engine.visualLatencyMs = p.visualLatencyMs
    if (p.level) {
      const song = get().song
      if (song) {
        const info = applyLevel(song, p.level)
        set({ playEvents: info.events, levelInfo: info })
      }
    }
  },

  openSong: async (song) => {
    const token = ++loadToken
    set({ loading: `Cargando «${song.title}»…`, error: null })
    try {
      // Decodificar/renderizar no requiere que el AudioContext esté activo.
      const ctx = engine.ctx ?? new OfflineAudioContext(2, 44100, 44100)
      const stems = await loadSongStems(ctx, song)
      if (token !== loadToken) return
      const info = eventsForLevel(song, get().settings.level)
      engine.loadSong(song, info.events, stems)
      set({ song, playEvents: info.events, levelInfo: info, history: { past: [], future: [] }, dirty: false, selection: [], loading: null })
    } catch (e) {
      if (token === loadToken) set({ loading: null, error: e instanceof Error ? e.message : String(e) })
    }
  },

  patchSong: (p) => {
    const song = get().song
    if (!song) return
    const next = { ...song, ...p, updatedAt: Date.now() }
    if (p.audio) engine.setAudioOffset(next.audio?.offset ?? 0)
    if (p.timeline) {
      if (song.origin === 'transcription' || song.origin === 'audio') {
        // Golpes detectados en el audio: el tiempo real manda; se recalculan los ticks y se recuantiza.
        next.events = annotateEvents(next.timeline, quantizeEvents(next.timeline, assignRawTicks(next.timeline, next.events)).events)
      } else {
        // Partitura/MIDI: la posición musical manda; se recalcula el tiempo de cada golpe.
        next.events = annotateEvents(next.timeline, next.events.map((e) => ({ ...e, time: tickToSeconds(next.timeline, e.tick) })))
      }
    }
    if (p.timeline || p.pedalRole) {
      engine.pedalRole = next.pedalRole
      const info = applyLevel(next, get().settings.level)
      set({ song: next, playEvents: info.events, levelInfo: info, dirty: true })
    } else set({ song: next, dirty: true })
  },

  editEvents: (nextEvents) => {
    const song = get().song
    if (!song) return
    const { past } = get().history
    const events = annotateEvents(song.timeline, [...nextEvents].sort((a, b) => a.tick - b.tick || a.time - b.time))
    const next = { ...song, events, updatedAt: Date.now() }
    const info = applyLevel(next, get().settings.level)
    set({ song: next, playEvents: info.events, levelInfo: info, history: { past: [...past.slice(-99), song.events], future: [] }, dirty: true })
  },

  undo: () => {
    const { song, history } = get()
    if (!song || history.past.length === 0) return
    const prev = history.past[history.past.length - 1]
    const next = { ...song, events: prev }
    const info = applyLevel(next, get().settings.level)
    set({ song: next, playEvents: info.events, levelInfo: info, history: { past: history.past.slice(0, -1), future: [song.events, ...history.future] }, dirty: true })
  },

  redo: () => {
    const { song, history } = get()
    if (!song || history.future.length === 0) return
    const [first, ...rest] = history.future
    const next = { ...song, events: first }
    const info = applyLevel(next, get().settings.level)
    set({ song: next, playEvents: info.events, levelInfo: info, history: { past: [...history.past, song.events], future: rest }, dirty: true })
  },

  save: async () => {
    const song = get().song
    if (!song) return
    await saveSong({ ...song, updatedAt: Date.now() })
    set({ dirty: false })
    await get().refreshLibrary()
  },

  refreshLibrary: async () => {
    try {
      set({ library: await listSongs() })
    } catch {
      /* IndexedDB no disponible (modo privado) */
    }
  },

  setSelection: (selection) => set({ selection }),

  mapping: () => {
    const { mappingId, customMappings } = get().settings
    return [...BUILTIN_MAPPINGS, ...customMappings].find((m) => m.id === mappingId) ?? GM_MAPPING
  },
}))

engine.visualLatencyMs = useApp.getState().settings.visualLatencyMs
engine.setVolumes(useApp.getState().settings.volumes)
