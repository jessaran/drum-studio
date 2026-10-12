import { createDemoSong } from '../core/demoSong'
import type { Song, StemRef } from '../core/types'
import { loadBlob } from '../state/persistence'
import { renderDemoBacking, renderDemoDrums } from './renderDemo'

/** Carga (y cachea) los stems de audio de una canción como AudioBuffer. */

const cache = new Map<string, Promise<AudioBuffer>>()

export async function decodeBlob(ctx: BaseAudioContext, blob: Blob): Promise<AudioBuffer> {
  const data = await blob.arrayBuffer()
  return ctx.decodeAudioData(data)
}

export function loadStem(ctx: BaseAudioContext, stem: StemRef): Promise<AudioBuffer> {
  const key = stem.blobKey
  const hit = cache.get(key)
  if (hit) return hit
  const p = (async () => {
    if (key === 'generated:demo-drums') return renderDemoDrums(createDemoSong())
    if (key === 'generated:demo-backing') return renderDemoBacking(createDemoSong())
    const blob = await loadBlob(key)
    if (!blob) throw new Error(`No se encuentra el audio "${stem.name}" en el almacenamiento local.`)
    return decodeBlob(ctx, blob)
  })()
  cache.set(key, p)
  p.catch(() => cache.delete(key))
  return p
}

export async function loadSongStems(ctx: BaseAudioContext, song: Song): Promise<{ ref: StemRef; buffer: AudioBuffer }[]> {
  const stems = song.audio?.stems ?? []
  return Promise.all(stems.map(async (ref) => ({ ref, buffer: await loadStem(ctx, ref) })))
}

/** Registra un buffer ya decodificado (p. ej. justo tras importar) para no decodificar dos veces. */
export function primeStem(key: string, buffer: AudioBuffer) {
  cache.set(key, Promise.resolve(buffer))
}
