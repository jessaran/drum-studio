import { useEffect, useState, useSyncExternalStore } from 'react'
import { engine, type EngineState } from '../engine/engine'
import { useApp } from './store'

export function useEngine(): EngineState {
  return useSyncExternalStore(engine.subscribe, engine.getSnapshot)
}

/** Tema efectivo (resuelve "sistema") y lo aplica a <html>. */
export function useResolvedDark(): boolean {
  const theme = useApp((s) => s.settings.theme)
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const on = () => setSystemDark(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  const dark = theme === 'dark' || (theme === 'system' && systemDark)
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  }, [dark])
  return dark
}

export function formatTime(t: number): string {
  const s = Math.max(0, t)
  const m = Math.floor(s / 60)
  const sec = s - m * 60
  return `${m}:${sec.toFixed(1).padStart(4, '0')}`
}
