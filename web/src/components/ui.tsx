import { Label, Modal, Slider, Switch } from '@heroui/react'
import type { ReactNode } from 'react'

/** Envoltorios finos sobre HeroUI para mantener coherentes los controles. */

export function Range({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
  className,
  onChangeEnd,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
  format?: (v: number) => string
  className?: string
  /** Se llama al soltar (útil para cambios costosos como el time-stretch). */
  onChangeEnd?: (v: number) => void
}) {
  return (
    <Slider
      className={className ?? 'w-full'}
      value={value}
      minValue={min}
      maxValue={max}
      step={step}
      onChange={(v) => onChange(Array.isArray(v) ? v[0] : v)}
      onChangeEnd={onChangeEnd ? (v) => onChangeEnd(Array.isArray(v) ? v[0] : v) : undefined}
      aria-label={label}
    >
      <div className="flex justify-between text-sm">
        <Label>{label}</Label>
        <span className="muted tabular-nums">{format ? format(value) : value}</span>
      </div>
      <Slider.Track>
        <Slider.Fill />
        <Slider.Thumb />
      </Slider.Track>
    </Slider>
  )
}

export function Toggle({ label, isSelected, onChange, description }: { label: string; isSelected: boolean; onChange: (v: boolean) => void; description?: string }) {
  return (
    <Switch isSelected={isSelected} onChange={onChange}>
      <Switch.Control>
        <Switch.Thumb />
      </Switch.Control>
      <Switch.Content>
        <Label>{label}</Label>
        {description && <span className="muted text-xs block">{description}</span>}
      </Switch.Content>
    </Switch>
  )
}

export function Sheet({ title, isOpen, onClose, children, wide }: { title: string; isOpen: boolean; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={(o) => !o && onClose()}>
        <Modal.Container>
          <Modal.Dialog className={wide ? 'sm:max-w-[920px] w-[96vw]' : 'sm:max-w-[560px] w-[94vw]'}>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>{title}</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="max-h-[72dvh] overflow-y-auto">{children}</Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
    </Modal.Backdrop>
  )
}

export function Seg<T extends string>({ value, options, onChange, ariaLabel }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; ariaLabel: string }) {
  return (
    <div className="seg" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

const PATHS: Record<string, string> = {
  play: 'M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z',
  pause: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z',
  stop: 'M6 6h12v12H6z',
  prev: 'M6 5h2v14H6zM19 5.8v12.4a.8.8 0 0 1-1.25.66L9.5 12.66a.8.8 0 0 1 0-1.32l8.25-6.2A.8.8 0 0 1 19 5.8z',
  next: 'M16 5h2v14h-2zM5 5.8v12.4a.8.8 0 0 0 1.25.66l8.25-6.2a.8.8 0 0 0 0-1.32L6.25 5.14A.8.8 0 0 0 5 5.8z',
  rewind: 'M12 5V2L7 6l5 4V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z',
  loop: 'M7 7h10v3l4-4-4-4v3H5v6h2zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2z',
  metronome: 'M10.5 2h3l4.5 19H6zM12 6l-1 9h2zM15.5 6.5l3-3 1 1-3 3z',
  import: 'M12 3v11m0 0l-4-4m4 4l4-4M4 17v3h16v-3',
  gear: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zm8.4 4.6.1-1.1-.1-1.1 2-1.6-2-3.4-2.4 1a8 8 0 0 0-1.9-1.1L15.7 3h-3.9l-.4 2.6a8 8 0 0 0-1.9 1.1l-2.4-1-2 3.4 2 1.6-.1 1.1.1 1.1-2 1.6 2 3.4 2.4-1a8 8 0 0 0 1.9 1.1l.4 2.6h3.9l.4-2.6a8 8 0 0 0 1.9-1.1l2.4 1 2-3.4z',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  library: 'M4 4h4v16H4zM10 4h4v16h-4zM16.5 4.5l3.8-1 3.7 15.5-3.8 1z',
  wave: 'M3 12h2M7 8v8M11 5v14M15 8v8M19 10v4M21 12h0',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  save: 'M5 3h11l3 3v15H5zM8 3v6h7V3M8 14h8v7H8z',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3',
  redo: 'M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14',
  plus: 'M12 5v14M5 12h14',
  sparkles: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z',
  sun: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12 1v3M12 20v3M1 12h3M20 12h3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z',
}

const STROKE = new Set(['import', 'edit', 'wave', 'chart', 'undo', 'redo', 'trash', 'plus', 'save', 'sun'])

export function Icon({ name, size = 20 }: { name: keyof typeof PATHS; size?: number }) {
  const stroke = STROKE.has(name)
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill={stroke ? 'none' : 'currentColor'} stroke={stroke ? 'currentColor' : 'none'} strokeWidth={stroke ? 2 : 0} strokeLinecap="round" strokeLinejoin="round">
      <path d={PATHS[name]} />
    </svg>
  )
}
