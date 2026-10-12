import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { alphaTab } from '@coderline/alphatab-vite'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // GitHub Pages publica en /<repositorio>/; en local, en la raíz.
  base: process.env.VITE_BASE ?? '/',
  plugins: [react(), tailwindcss(), alphaTab()],
  server: { host: true, port: 5173 },
  // alphaTab resuelve sus fuentes y su worker relativos a su propio módulo: no pre-empaquetar.
  optimizeDeps: { exclude: ['@coderline/alphatab'] },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
