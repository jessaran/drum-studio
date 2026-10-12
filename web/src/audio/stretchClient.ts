/** Ejecuta el time-stretch en un Web Worker y cachea el resultado por buffer y velocidad. */

let worker: Worker | null = null
let nextId = 1
const pending = new Map<number, (ch: Float32Array[]) => void>()
const cache = new WeakMap<AudioBuffer, Map<number, Promise<AudioBuffer>>>()

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./timeStretch.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (ev: MessageEvent<{ id: number; channels: Float32Array[] }>) => {
      pending.get(ev.data.id)?.(ev.data.channels)
      pending.delete(ev.data.id)
    }
  }
  return worker
}

export function stretchBuffer(ctx: BaseAudioContext, buffer: AudioBuffer, rate: number): Promise<AudioBuffer> {
  const key = Math.round(rate * 1000) / 1000
  let perBuf = cache.get(buffer)
  if (!perBuf) {
    perBuf = new Map()
    cache.set(buffer, perBuf)
  }
  const hit = perBuf.get(key)
  if (hit) return hit
  const p = new Promise<AudioBuffer>((resolve) => {
    if (key === 1) return resolve(buffer)
    const id = nextId++
    const channels: Float32Array[] = []
    for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c).slice())
    pending.set(id, (out) => {
      const b = ctx.createBuffer(out.length, out[0].length, buffer.sampleRate)
      out.forEach((ch, i) => b.copyToChannel(ch as Float32Array<ArrayBuffer>, i))
      resolve(b)
    })
    getWorker().postMessage({ id, rate: key, channels }, channels.map((c) => c.buffer))
  })
  perBuf.set(key, p)
  return p
}
