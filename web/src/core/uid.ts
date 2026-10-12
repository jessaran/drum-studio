let counter = 0

export function uid(prefix = 'e'): string {
  counter = (counter + 1) % 1_000_000
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}
