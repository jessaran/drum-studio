#!/usr/bin/env bash
# Arranca DrumStudio: la app web (siempre) y el servicio de transcripción (con --backend).
#   ./start.sh            solo la app (modo MIDI/partitura, no necesita Python)
#   ./start.sh --backend  app + servicio de transcripción en :8000
set -euo pipefail
cd "$(dirname "$0")"

IP=$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")

if [ ! -d web/node_modules ]; then
  (cd web && npm install)
fi

if [ "${1:-}" = "--backend" ]; then
  ./backend/run.sh &
  BACK=$!
  trap 'kill $BACK 2>/dev/null' EXIT
  echo "Servicio de transcripción: http://$IP:8000 (configúralo en la app: Ajustes → Transcripción)"
fi

echo "App: http://localhost:5173  ·  desde el iPad: http://$IP:5173"
cd web && npm run dev
