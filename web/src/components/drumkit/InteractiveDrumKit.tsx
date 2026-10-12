import { forwardRef, memo, useEffect, useImperativeHandle, useMemo } from 'react'
import { INSTRUMENTS, PEDAL_ROLES, type InstrumentId, type PedalRole } from '../../core/instruments'
import type { FrameSource } from '../../engine/visualLoop'
import { PEDAL_SHAPE, PIECES, VIEWBOX, visualPiece, type PieceGeometry } from './geometry'
import { DEFAULT_ANIMATOR, KitAnimator, type AnimatorOptions, type KitEvent } from './kitAnimator'
import './drumkit.css'

export interface DrumKitHandle {
  /** Activa una pieza inmediatamente (lo puede llamar el motor de sincronización). */
  triggerDrum: (instrument: InstrumentId, velocity?: number) => void
  activeInstruments: () => InstrumentId[]
}

export interface InteractiveDrumKitProps {
  /** Golpes con tiempo en segundos del reproductor. */
  events?: KitEvent[]
  /** Fuente de frames con la posición real del reproductor. Sin ella, solo hay golpes manuales. */
  frames?: FrameSource
  /** Clic/toque sobre una pieza (modo demostración: animación + sonido opcional). */
  onPieceHit?: (instrument: InstrumentId, velocity: number) => void
  interactive?: boolean
  animation?: Partial<AnimatorOptions>
  showLabels?: boolean
  leftHanded?: boolean
  pedalRole?: PedalRole
  className?: string
}

/** Variante más brillante y saturada del color (para el destello). */
function litColor(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  let r = (n >> 16) / 255
  let g = ((n >> 8) & 255) / 255
  let b = (n & 255) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    h /= 6
  }
  const s2 = Math.min(1, s * 1.25 + 0.05)
  const l2 = l < 0.2 ? 0.38 : Math.min(0.82, l + 0.14)
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  const q = l2 < 0.5 ? l2 * (1 + s2) : l2 + s2 - l2 * s2
  const p = 2 * l2 - q
  r = hue2rgb(p, q, h + 1 / 3)
  g = hue2rgb(p, q, h)
  b = hue2rgb(p, q, h - 1 / 3)
  return '#' + [r, g, b].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('')
}

const OUTLINE = 'var(--kit-outline)'

function limbLabel(id: InstrumentId, leftHanded: boolean, pedalRole: PedalRole): string {
  const def = INSTRUMENTS[id]
  let side: 'R' | 'L' | 'RL' = id === 'pedal' ? PEDAL_ROLES[pedalRole].limb : def.hand
  if (leftHanded && side !== 'RL') side = side === 'R' ? 'L' : 'R'
  const limb = def.limb === 'foot' ? 'P' : 'M'
  if (side === 'RL') return 'M'
  return `${limb}${side === 'R' ? 'D' : 'I'}`
}

interface PieceProps {
  g: PieceGeometry
  register: (id: InstrumentId, el: SVGGElement | null) => void
  onHit?: (id: InstrumentId, e: React.PointerEvent) => void
  label: string | null
}

const Piece = memo(function Piece({ g, register, onHit, label }: PieceProps) {
  const def = INSTRUMENTS[g.id]
  const lit = litColor(def.color)
  const ringColor = g.kind === 'pedal' ? '#c9ccd1' : def.stroke
  const name = g.id === 'kick' ? 'Bombo (pedal)' : def.label
  return (
    <g
      ref={(el) => register(g.id, el)}
      className="kit-piece"
      data-instrument={g.id}
      role="button"
      aria-label={name}
      onPointerDown={onHit ? (e) => onHit(g.id, e) : undefined}
    >
      <title>{name}</title>
      <circle data-part="glow" className="kit-glow" cx={g.cx} cy={g.cy} r={g.r * 1.18} fill={`url(#glow-${g.id})`} />
      <circle data-part="approach" className="kit-approach" cx={g.cx} cy={g.cy} r={g.r + 6} fill="none" stroke={ringColor} strokeWidth={7} />
      <g data-part="body" className="kit-body">
        {g.kind === 'cymbal' && (
          <>
            <circle cx={g.cx} cy={g.cy} r={g.r} fill={g.rings![0]} stroke={OUTLINE} strokeWidth={5} />
            <circle cx={g.cx} cy={g.cy} r={g.r * 0.78} fill={g.rings![1]} />
            <circle cx={g.cx} cy={g.cy} r={g.r * 0.55} fill={g.rings![2]} />
            <circle cx={g.cx} cy={g.cy} r={g.r * 0.34} fill={g.rings![3]} />
            <circle data-part="flash" className="kit-flash" cx={g.cx} cy={g.cy} r={g.r} fill={lit} style={{ mixBlendMode: 'normal' }} />
            <circle cx={g.cx} cy={g.cy} r={g.r * 0.135} fill="#1d1d1f" />
            <circle cx={g.cx} cy={g.cy} r={g.r * 0.045} fill="#d9d9d9" />
          </>
        )}
        {g.kind === 'drum' && (
          <>
            {Array.from({ length: g.lugs! }, (_, i) => {
              const a = ((g.lugOffset! + (360 / g.lugs!) * i) * Math.PI) / 180
              return (
                <circle
                  key={i}
                  cx={g.cx + Math.cos(a) * (g.r + 2)}
                  cy={g.cy + Math.sin(a) * (g.r + 2)}
                  r={g.id === 'kick' ? 15 : 12}
                  fill={g.id === 'kick' ? '#9a9da3' : '#e4e6ea'}
                  stroke={OUTLINE}
                  strokeWidth={4}
                />
              )
            })}
            <circle cx={g.cx} cy={g.cy} r={g.r} fill={g.id === 'kick' ? '#9a9da3' : '#eceef1'} stroke={OUTLINE} strokeWidth={5} />
            <circle cx={g.cx} cy={g.cy} r={g.r - 7} fill="none" stroke={g.id === 'kick' ? '#6f737a' : '#ffffff'} strokeWidth={4} />
            <circle cx={g.cx} cy={g.cy} r={g.head! + 4} fill={g.id === 'kick' ? '#4a4d52' : '#ffffff'} />
            <circle cx={g.cx} cy={g.cy} r={g.head!} fill={def.color} stroke={def.stroke} strokeWidth={5} />
            <circle data-part="flash" className="kit-flash" cx={g.cx} cy={g.cy} r={g.head!} fill={lit} stroke={def.stroke} strokeWidth={5} />
          </>
        )}
        {g.kind === 'pedal' && (
          <>
            <circle cx={PEDAL_SHAPE.knob.cx} cy={PEDAL_SHAPE.knob.cy} r={PEDAL_SHAPE.knob.r} fill="#55595f" stroke={OUTLINE} strokeWidth={5} />
            <rect {...PEDAL_SHAPE.stem} rx={4} fill="#8c9096" stroke={OUTLINE} strokeWidth={4} />
            <path d={PEDAL_SHAPE.body} fill="#c9ccd1" stroke={OUTLINE} strokeWidth={5} />
            <path d={PEDAL_SHAPE.window} fill="#6b6f75" />
            <path data-part="flash" className="kit-flash" d={PEDAL_SHAPE.body} fill="#eef0f3" stroke={OUTLINE} strokeWidth={5} />
          </>
        )}
      </g>
      {g.kind === 'pedal' ? (
        <path data-part="pulse" className="kit-pulse" d={PEDAL_SHAPE.body} fill="none" stroke={ringColor} strokeWidth={6} />
      ) : (
        <circle data-part="pulse" className="kit-pulse" cx={g.cx} cy={g.cy} r={g.kind === 'drum' ? g.head! : g.r} fill="none" stroke={ringColor} strokeWidth={8} />
      )}
      {label && (
        <g className="kit-label" pointerEvents="none">
          <rect x={g.cx - 30} y={g.kind === 'pedal' ? 832 : g.cy + (g.kind === 'drum' ? g.head! : g.r) * 0.45} width={60} height={34} rx={17} />
          <text x={g.cx} y={(g.kind === 'pedal' ? 832 : g.cy + (g.kind === 'drum' ? g.head! : g.r) * 0.45) + 24} textAnchor="middle">
            {label}
          </text>
        </g>
      )}
    </g>
  )
})

/**
 * Batería vista desde arriba, reconstruida en SVG a partir de la imagen de
 * referencia. Cada pieza es un grupo independiente que se anima por separado.
 */
export const InteractiveDrumKit = forwardRef<DrumKitHandle, InteractiveDrumKitProps>(function InteractiveDrumKit(
  { events, frames, onPieceHit, interactive = true, animation, showLabels = false, leftHanded = false, pedalRole = 'hiHatPedal', className },
  ref,
) {
  const animator = useMemo(() => new KitAnimator(DEFAULT_ANIMATOR), [])

  useEffect(() => {
    animator.opts = { ...DEFAULT_ANIMATOR, ...animation }
  }, [animator, animation])

  useEffect(() => {
    animator.setEvents((events ?? []).map((e) => (e.instrument === 'pedal' ? { ...e, instrument: visualPiece(e.instrument, pedalRole) } : e)))
  }, [animator, events, pedalRole])

  useImperativeHandle(ref, () => ({
    triggerDrum: (instrument, velocity = 100) => animator.trigger(visualPiece(instrument, pedalRole), velocity),
    // Incluye "pedal" cuando su pieza visual está activa.
    activeInstruments: () => {
      const a = animator.activeInstruments()
      return a.includes(visualPiece('pedal', pedalRole)) ? [...a, 'pedal'] : a
    },
  }))

  // Render por frame: con fuente externa (reloj del reproductor) o con un rAF local para los golpes manuales.
  useEffect(() => {
    if (frames) {
      return frames.subscribe((f) => {
        // En pausa no se muestran destellos de la canción (solo los toques manuales).
        animator.render(f.playing ? f.pos : null, f.rate, f.now)
      })
    }
    let raf = 0
    const loop = (now: number) => {
      animator.render(null, 1, now)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [animator, frames])

  const register = useMemo(
    () => (id: InstrumentId, el: SVGGElement | null) => {
      if (!el) return animator.register(id, null)
      const q = (part: string) => el.querySelector(`[data-part="${part}"]`) as SVGElement
      const g = PIECES.find((p) => p.id === id)!
      animator.register(id, { body: q('body') as SVGGElement, flash: q('flash'), pulse: q('pulse'), glow: q('glow'), approach: q('approach'), cx: g.cx, cy: g.cy })
    },
    [animator],
  )

  const onHit = useMemo(
    () =>
      interactive
        ? (id: InstrumentId, e: React.PointerEvent) => {
            e.preventDefault()
            // Toque más fuerte en el centro de la pieza.
            const velocity = 105
            animator.trigger(id, velocity)
            onPieceHit?.(id, velocity)
          }
        : undefined,
    [animator, interactive, onPieceHit],
  )

  // Orden de pintado: platillos y tambores; el pedal por encima del bombo no se solapa.
  return (
    <svg
      className={`drumkit ${className ?? ''}`}
      viewBox={`${VIEWBOX.x} ${VIEWBOX.y} ${VIEWBOX.w} ${VIEWBOX.h}`}
      preserveAspectRatio="xMidYMid meet"
      role="group"
      aria-label="Batería interactiva"
    >
      <defs>
        {PIECES.map((p) => (
          <radialGradient key={p.id} id={`glow-${p.id}`}>
            <stop offset="55%" stopColor={p.id === 'kick' ? '#b8c0cc' : INSTRUMENTS[p.id].color} stopOpacity={0.75} />
            <stop offset="100%" stopColor={p.id === 'kick' ? '#b8c0cc' : INSTRUMENTS[p.id].color} stopOpacity={0} />
          </radialGradient>
        ))}
      </defs>
      {PIECES.map((g) => (
        <Piece key={g.id} g={g} register={register} onHit={onHit} label={showLabels ? limbLabel(g.id, leftHanded, pedalRole) : null} />
      ))}
    </svg>
  )
})
