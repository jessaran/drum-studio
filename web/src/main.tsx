import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { engine } from './engine/engine'
import { frames } from './engine/frames'
import { useApp } from './state/store'

// Solo en desarrollo: acceso a las instancias únicas para pruebas manuales/automatizadas en el navegador.
if (import.meta.env.DEV) Object.assign(window, { __ds: { engine, frames, useApp } })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
