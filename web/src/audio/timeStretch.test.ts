import { describe, expect, it } from 'vitest'
import { timeStretch } from './timeStretch'

const SR = 44100

/** Tren de golpes: ráfagas cortas de ruido en posiciones conocidas. */
function clickTrain(positionsSec: number[], lengthSec: number): Float32Array {
  const x = new Float32Array(Math.ceil(lengthSec * SR))
  let s = 1
  for (const p of positionsSec) {
    const i0 = Math.round(p * SR)
    for (let n = 0; n < 600; n++) {
      s = (s * 16807) % 2147483647
      x[i0 + n] += (s / 2147483647 - 0.5) * 2 * Math.exp(-n / 120)
    }
  }
  return x
}

function onsets(x: Float32Array, threshold = 0.25): number[] {
  const out: number[] = []
  let last = -Infinity
  for (let i = 0; i < x.length; i++) {
    if (Math.abs(x[i]) > threshold && i - last > SR * 0.1) {
      out.push(i / SR)
      last = i
    }
  }
  return out
}

describe('time-stretch WSOLA', () => {
  for (const rate of [0.5, 0.75, 1.25, 1.5]) {
    it(`rate ${rate}: duración ${1 / rate}x y golpes en tiempo/rate (±12 ms)`, () => {
      const pos = Array.from({ length: 12 }, (_, i) => 0.3 + i * 0.41)
      const x = clickTrain(pos, 5.5)
      const [y] = timeStretch([x], rate)
      expect(y.length).toBe(Math.ceil(x.length / rate))
      const found = onsets(y)
      expect(found.length).toBe(pos.length)
      found.forEach((t, i) => expect(Math.abs(t - pos[i] / rate)).toBeLessThan(0.012))
    })
  }
})
