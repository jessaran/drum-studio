import { timeStretch } from './timeStretch'

interface Req {
  id: number
  rate: number
  channels: Float32Array[]
}

self.onmessage = (ev: MessageEvent<Req>) => {
  const { id, rate, channels } = ev.data
  const out = timeStretch(channels, rate)
  ;(self as unknown as Worker).postMessage({ id, channels: out }, out.map((c) => c.buffer))
}
