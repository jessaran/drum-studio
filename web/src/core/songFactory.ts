import { computeBars, createTimeline, secondsToTick, tickToSeconds } from './timeline'
import type { DrumEvent, IgnoredHit, Section, Song, SongOrigin, StemRef, Timeline } from './types'
import { uid } from './uid'

export function buildSong(p: {
  title: string
  artist?: string
  origin: SongOrigin
  timeline?: Timeline
  events?: DrumEvent[]
  ignoredHits?: IgnoredHit[]
  sections?: Section[]
  durationTicks?: number
  audio?: { stems: StemRef[]; offset: number; duration: number }
  notes?: string
}): Song {
  const timeline = p.timeline ?? createTimeline(120)
  const events = p.events ?? []
  const lastEventTime = events.reduce((m, e) => Math.max(m, e.time), 0)
  const scoreEnd = p.durationTicks ? tickToSeconds(timeline, p.durationTicks) : 0
  let duration = Math.max(scoreEnd, lastEventTime + 1)
  if (p.audio) duration = Math.max(duration, p.audio.duration - p.audio.offset)
  // Redondea al final del compás para que la partitura acabe limpia.
  const bars = computeBars(timeline, secondsToTick(timeline, duration))
  const endBar = bars.find((b) => b.endTime >= duration) ?? bars[bars.length - 1]
  if (endBar && !p.audio) duration = Math.max(duration, endBar.endTime)
  const now = Date.now()
  return {
    id: uid('song'),
    title: p.title || 'Sin título',
    artist: p.artist ?? '',
    origin: p.origin,
    timeline,
    events,
    ignoredHits: p.ignoredHits?.length ? p.ignoredHits : undefined,
    duration,
    sections: p.sections ?? [],
    pedalRole: 'hiHatPedal',
    audio: p.audio ? { stems: p.audio.stems, offset: p.audio.offset } : undefined,
    createdAt: now,
    updatedAt: now,
    notes: p.notes,
  }
}
