import type { InstrumentId, PedalRole } from '../core/instruments'

/**
 * Sintetizador de batería con Web Audio. Funciona igual en un AudioContext
 * en tiempo real (sonidos guía, prueba de piezas) que en un OfflineAudioContext
 * (render del audio de la demo). Todos los sonidos se programan en un tiempo
 * absoluto `when` del reloj de audio: nunca con setTimeout.
 */

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>()

function noise(ctx: BaseAudioContext): AudioBuffer {
  let b = noiseCache.get(ctx)
  if (b) return b
  const len = Math.floor(ctx.sampleRate * 2)
  b = ctx.createBuffer(1, len, ctx.sampleRate)
  const d = b.getChannelData(0)
  // Ruido blanco determinista (misma demo en cada render).
  let s = 0x12345678
  for (let i = 0; i < len; i++) {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    d[i] = ((s >>> 0) / 0xffffffff) * 2 - 1
  }
  noiseCache.set(ctx, b)
  return b
}

function env(g: GainNode, when: number, peak: number, attack: number, decay: number) {
  g.gain.setValueAtTime(0.0001, when)
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), when + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, when + attack + decay)
}

function noiseVoice(ctx: BaseAudioContext, dest: AudioNode, when: number, peak: number, decay: number, filter: BiquadFilterType, freq: number, q = 0.7) {
  const src = ctx.createBufferSource()
  src.buffer = noise(ctx)
  const f = ctx.createBiquadFilter()
  f.type = filter
  f.frequency.value = freq
  f.Q.value = q
  const g = ctx.createGain()
  env(g, when, peak, 0.001, decay)
  src.connect(f).connect(g).connect(dest)
  const offset = (when * 7.31) % 1.5 // variación del fragmento de ruido
  src.start(when, offset, decay + 0.05)
  return src
}

function tone(ctx: BaseAudioContext, dest: AudioNode, when: number, f0: number, f1: number, sweep: number, peak: number, decay: number, type: OscillatorType = 'sine') {
  const o = ctx.createOscillator()
  o.type = type
  o.frequency.setValueAtTime(f0, when)
  o.frequency.exponentialRampToValueAtTime(f1, when + sweep)
  const g = ctx.createGain()
  env(g, when, peak, 0.002, decay)
  o.connect(g).connect(dest)
  o.start(when)
  o.stop(when + decay + 0.05)
  return o
}

function metallic(ctx: BaseAudioContext, dest: AudioNode, when: number, peak: number, decay: number, hp: number, base = 1) {
  // Seis osciladores cuadrados inarmónicos (clásico 808) + paso alto.
  const ratios = [2, 3, 4.16, 5.43, 6.79, 8.21]
  const f = ctx.createBiquadFilter()
  f.type = 'highpass'
  f.frequency.value = hp
  const g = ctx.createGain()
  env(g, when, peak, 0.001, decay)
  f.connect(g).connect(dest)
  const nodes: AudioScheduledSourceNode[] = []
  for (const r of ratios) {
    const o = ctx.createOscillator()
    o.type = 'square'
    o.frequency.value = 40 * r * base
    o.connect(f)
    o.start(when)
    o.stop(when + decay + 0.05)
    nodes.push(o)
  }
  return nodes
}

export function playDrum(
  ctx: BaseAudioContext,
  dest: AudioNode,
  instrument: InstrumentId,
  when: number,
  velocity = 100,
  articulation?: string,
  pedalRole: PedalRole = 'hiHatPedal',
): AudioScheduledSourceNode[] {
  const v = Math.max(0.05, Math.min(1, velocity / 127))
  const out: AudioScheduledSourceNode[] = []
  const add = (n: AudioScheduledSourceNode | AudioScheduledSourceNode[]) => (Array.isArray(n) ? out.push(...n) : out.push(n))
  switch (instrument) {
    case 'kick':
      add(tone(ctx, dest, when, 150, 45, 0.09, 1.0 * v, 0.35))
      add(noiseVoice(ctx, dest, when, 0.15 * v, 0.02, 'lowpass', 3000))
      break
    case 'snare':
      if (articulation === 'sidestick') {
        add(tone(ctx, dest, when, 1700, 900, 0.02, 0.35 * v, 0.05, 'triangle'))
        break
      }
      add(tone(ctx, dest, when, 260, 180, 0.05, 0.45 * v, 0.12, 'triangle'))
      add(noiseVoice(ctx, dest, when, 0.55 * v, 0.18, 'highpass', 1500))
      break
    case 'tom1':
      add(tone(ctx, dest, when, 260, 190, 0.18, 0.7 * v, 0.32))
      add(noiseVoice(ctx, dest, when, 0.06 * v, 0.04, 'bandpass', 2500))
      break
    case 'tom2':
      add(tone(ctx, dest, when, 200, 140, 0.2, 0.75 * v, 0.38))
      add(noiseVoice(ctx, dest, when, 0.06 * v, 0.04, 'bandpass', 2000))
      break
    case 'floorTom':
      add(tone(ctx, dest, when, 140, 90, 0.25, 0.85 * v, 0.5))
      add(noiseVoice(ctx, dest, when, 0.06 * v, 0.05, 'bandpass', 1500))
      break
    case 'hiHat': {
      const open = articulation === 'open' || articulation === 'half'
      add(metallic(ctx, dest, when, 0.22 * v, open ? 0.42 : 0.05, 7000))
      add(noiseVoice(ctx, dest, when, 0.18 * v, open ? 0.4 : 0.045, 'highpass', 8000))
      break
    }
    case 'pedal':
      if (pedalRole === 'doubleKick') return playDrum(ctx, dest, 'kick', when, velocity)
      if (pedalRole === 'cowbell') {
        add(tone(ctx, dest, when, 800, 800, 0.01, 0.3 * v, 0.15, 'square'))
        add(tone(ctx, dest, when, 540, 540, 0.01, 0.3 * v, 0.15, 'square'))
        break
      }
      add(metallic(ctx, dest, when, 0.12 * v, 0.03, 6000))
      add(noiseVoice(ctx, dest, when, 0.08 * v, 0.03, 'bandpass', 6000, 2))
      break
    case 'crash':
      add(metallic(ctx, dest, when, 0.16 * v, 1.6, 5000, 1.12))
      add(noiseVoice(ctx, dest, when, 0.35 * v, 1.8, 'highpass', 4000))
      break
    case 'ride':
      if (articulation === 'bell') {
        add(metallic(ctx, dest, when, 0.2 * v, 0.7, 3000, 1.6))
        break
      }
      add(metallic(ctx, dest, when, 0.1 * v, 0.9, 6000, 1.3))
      add(noiseVoice(ctx, dest, when, 0.08 * v, 0.6, 'bandpass', 9000, 1.5))
      break
  }
  return out
}

/** Clic de metrónomo: tono corto, más agudo en el primer tiempo del compás. */
export function playClick(ctx: BaseAudioContext, dest: AudioNode, when: number, accent: boolean): AudioScheduledSourceNode {
  const o = ctx.createOscillator()
  o.type = 'sine'
  o.frequency.value = accent ? 1760 : 1175
  const g = ctx.createGain()
  g.gain.setValueAtTime(0.0001, when)
  g.gain.exponentialRampToValueAtTime(accent ? 0.9 : 0.6, when + 0.001)
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05)
  o.connect(g).connect(dest)
  o.start(when)
  o.stop(when + 0.06)
  return o
}
