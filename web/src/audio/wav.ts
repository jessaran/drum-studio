/** Codifica un AudioBuffer como WAV PCM de 16 bits (para enviarlo al servicio de transcripción). */
export function encodeWav(buffer: AudioBuffer, maxChannels = 2): Blob {
  const channels = Math.min(maxChannels, buffer.numberOfChannels)
  const len = buffer.length
  const data = new DataView(new ArrayBuffer(44 + len * channels * 2))
  const writeStr = (o: number, s: string) => [...s].forEach((c, i) => data.setUint8(o + i, c.charCodeAt(0)))
  writeStr(0, 'RIFF')
  data.setUint32(4, 36 + len * channels * 2, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  data.setUint32(16, 16, true)
  data.setUint16(20, 1, true)
  data.setUint16(22, channels, true)
  data.setUint32(24, buffer.sampleRate, true)
  data.setUint32(28, buffer.sampleRate * channels * 2, true)
  data.setUint16(32, channels * 2, true)
  data.setUint16(34, 16, true)
  writeStr(36, 'data')
  data.setUint32(40, len * channels * 2, true)
  const chData = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c))
  let o = 44
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < channels; c++) {
      const v = Math.max(-1, Math.min(1, chData[c][i]))
      data.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true)
      o += 2
    }
  }
  return new Blob([data.buffer], { type: 'audio/wav' })
}
