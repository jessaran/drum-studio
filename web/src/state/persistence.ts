import { createStore, del, get, keys, set } from 'idb-keyval'
import type { Song } from '../core/types'

/** Persistencia local en IndexedDB: canciones (eventos + ajustes) y blobs de audio. */

const songsStore = createStore('drumstudio', 'songs')
const blobStore = createStore('drumstudio-audio', 'blobs')

export interface SongMeta {
  id: string
  title: string
  artist: string
  origin: Song['origin']
  updatedAt: number
}

export async function saveSong(song: Song): Promise<void> {
  await set(song.id, song, songsStore)
}

export async function loadSongById(id: string): Promise<Song | undefined> {
  return get<Song>(id, songsStore)
}

export async function deleteSong(song: Song): Promise<void> {
  await del(song.id, songsStore)
  for (const s of song.audio?.stems ?? []) if (!s.blobKey.startsWith('generated:')) await del(s.blobKey, blobStore)
}

export async function listSongs(): Promise<SongMeta[]> {
  const ids = (await keys(songsStore)) as string[]
  const out: SongMeta[] = []
  for (const id of ids) {
    const s = await get<Song>(id, songsStore)
    if (s) out.push({ id: s.id, title: s.title, artist: s.artist, origin: s.origin, updatedAt: s.updatedAt })
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function saveBlob(key: string, blob: Blob): Promise<void> {
  await set(key, blob, blobStore)
}

export async function loadBlob(key: string): Promise<Blob | undefined> {
  return get<Blob>(key, blobStore)
}

const SETTINGS_KEY = 'drumstudio:settings'

export function loadSettings<T>(fallback: T): T {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback
  } catch {
    return fallback
  }
}

export function saveSettings<T>(s: T): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
  } catch {
    /* almacenamiento no disponible */
  }
}
