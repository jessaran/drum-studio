# DrumStudio

Aplicación web para aprender batería con canciones reales: batería SVG vista desde arriba que se ilumina con cada golpe, partitura de batería sincronizada (alphaTab), línea de tiempo simplificada, editor de golpes y transcripción automática opcional (servicio Python).

Optimizada para **iPad Pro 11"** (1194×834 horizontal / 834×1194 vertical) en Safari, instalable en la pantalla de inicio.

---

## Arranque rápido

Requisitos: Node 20+ (probado con 24). Para la transcripción: Python 3.9+.

```bash
./start.sh              # solo la app (MIDI/partitura; no necesita Python)
./start.sh --backend    # app + servicio de transcripción en :8000
```

O por separado:

```bash
cd web && npm install && npm run dev        # http://localhost:5173
cd backend && ./run.sh                      # http://localhost:8000 (crea .venv la primera vez)
backend/.venv/bin/pip install -r backend/requirements-separation.txt   # opcional: Demucs (~1 GB)
```

### En el iPad

1. Mac y iPad en la misma red. `./start.sh` muestra la URL (`http://<IP-del-Mac>:5173`).
2. Ábrela en Safari → Compartir → **Añadir a pantalla de inicio** (pantalla completa, sin barras).
3. Para la transcripción, en la app: Ajustes → Transcripción automática → servicio `http://<IP-del-Mac>:8000`.
4. El primer toque en Play activa el audio (requisito de iOS). La app pide a Safari que suene aunque el interruptor de silencio esté activado (`navigator.audioSession`).

### Online

- **App web**: https://jessaran.github.io/drum-studio/ (GitHub Pages). Cada `git push` a `main` ejecuta las pruebas, compila y publica (`.github/workflows/deploy.yml`).
- **Transcripción**: Hugging Face Space (Docker, CPU gratuita) construido desde `backend/` con el mismo workflow. Configuración única:
  1. En huggingface.co: crea un Space nuevo, SDK **Docker**, plantilla en blanco (p. ej. `drumstudio-transcripcion`), y un token de acceso con permiso **Write**.
  2. En este repositorio:
     ```bash
     gh secret set HF_TOKEN                                   # pega el token cuando lo pida
     gh variable set HF_SPACE --body "<usuario-hf>/drumstudio-transcripcion"
     gh variable set BACKEND_URL --body "https://<usuario-hf>-drumstudio-transcripcion.hf.space"
     gh workflow run Publicar
     ```
  3. La primera construcción del Space tarda ~10 min (instala PyTorch y descarga el modelo). En CPU, una canción de 4 min tarda unos 2–5 min. El Space se duerme tras 48 h sin uso y se despierta con la primera petición.
- Los MP3 que cargas se guardan solo en el dispositivo (IndexedDB). Solo se envían al Space si pides una transcripción, y allí se borran a las 2 h.

### Pruebas

```bash
cd web && npm test              # 21 pruebas: reloj, scheduler, jitter, cuantización, partitura, MIDI, MusicXML, time-stretch
cd web && npm run typecheck
cd backend && .venv/bin/python -m pytest -q   # 4 pruebas: pipeline y API
cd backend && .venv/bin/python evaluate.py ../web/public/samples/primer-groove-mix.wav ../web/public/samples/primer-groove-reference.json [--separate]
cd web && npm run gen:samples   # regenera los archivos de muestra
```

En la app: Ajustes → **Diagnóstico de sincronía** reproduce la canción y verifica, frame a frame en el dispositivo real, que cada golpe ilumina su pieza, y mide el jitter de frames y del temporizador.

---

## ¿Web o app nativa de iPad?

**Web (PWA)**, al menos hasta tener validada la experiencia:

- Web Audio da reloj con precisión de muestra y programación anticipada. La sincronización no depende de ser nativa.
- alphaTab, Demucs/librosa y el resto del ecosistema elegido son web/Python; en nativo habría que reescribir la partitura y el motor.
- Sin App Store ni cuenta de desarrollador; se actualiza al recargar; funciona también en el Mac.
- Pegas de la web en iPad: el audio necesita un primer toque; la latencia de salida declarada por Safari no siempre es exacta (por eso hay calibración); IndexedDB puede borrarse si no se usa la app durante semanas (instalarla en la pantalla de inicio lo mitiga).

Una app nativa (Swift + AVAudioEngine) ganaría en latencia de **entrada** (p. ej. evaluar golpes de una batería electrónica por MIDI/Bluetooth con <10 ms). Si más adelante quieres evaluar lo que tocas en tiempo real, ese sería el motivo para pasar a nativo o envolver la web con Capacitor.

---

## Evaluación de librerías

| Repositorio | Licencia | Estado | Decisión |
|---|---|---|---|
| CoderLine/alphaTab | MPL-2.0 | Activo (1.8.4) | **Usada** para dibujar la partitura. Soporta percusión (articulaciones GP7), MusicXML, Guitar Pro 3–7 y alphaTex. **No importa MIDI**: el MIDI se cuantiza aquí y se convierte a alphaTex. Su reproductor está desactivado: el cursor lo mueve el reloj de la app. MPL es copyleft por archivo: se usa como dependencia sin modificar, compatible. |
| opensheetmusicdisplay | BSD-3 | Activo | Descartada: solo MusicXML, su percusión es más limitada y no lee Guitar Pro. |
| Tonejs/Midi | MIT | Sin cambios desde 2023, estable | **Usada** para leer y escribir MIDI. |
| wavesurfer.js | BSD-3 | Activo (8.0) | **Usada** solo para mostrar la forma de onda en el ajuste de sincronía; el audio lo reproduce el motor propio. |
| adefossez/demucs | MIT | Fork mantenido (el original de Meta está archivado) | **Usada** (opcional) vía PyPI `demucs` 4.0.1 + PyTorch 2.8 (MPS en Apple Silicon). |
| gaston-michel/transcribir-bateria | **Sin licencia** | 4★ | Solo leída como referencia; no se copia código (sin licencia = todos los derechos reservados). |
| Teraldan/drums-audio-to-midi | **Sin licencia** | 0★ | Ídem. |
| varsaav/yodo | MIT | Sin cambios desde 2025, YOLOv4 | Descartada: pesos antiguos, sin mantenimiento, difícil de integrar. |

Implementación propia (no había nada reutilizable con licencia compatible): motor de sincronización, cuantización y conversión de eventos a partitura, exportación MusicXML, time-stretch WSOLA (las alternativas como SoundTouch son LGPL) y el clasificador de golpes.

Bibliotecas de interfaz: **HeroUI v3** como principal (Button, Slider, Switch, Modal, ProgressBar). Está construida sobre React Aria, que gestiona bien el táctil del iPad, y encaja con React 19 + Tailwind 4. No usé Magic UI ni las demás: la batería y la partitura son SVG/canvas propios y no necesitaban efectos adicionales.

---

## Arquitectura

```
web/src
  core/        modelo de datos y conversiones (sin navegador; probado con vitest)
    types.ts, instruments.ts, timeline.ts (mapa de tempo y compases)
    quantize.ts (rejilla por pulso), scoreModel.ts (2 voces, figuras, tresillos)
    alphaTex.ts, musicXml.ts, midiIO.ts, midiMapping.ts, scoreImport.ts
    difficulty.ts, demoSong.ts
  engine/      clock.ts (reloj único), scheduler.ts (lookahead), engine.ts (Web Audio), visualLoop.ts (rAF único)
  audio/       drumSynth.ts, renderDemo.ts, timeStretch.ts (+worker), wav.ts
  components/  drumkit/ (InteractiveDrumKit.tsx, kitAnimator.ts, geometry.ts, drumkit.css, demoSequence.ts)
               ScoreView.tsx (alphaTab), Highway.tsx, editor/, panels/
  state/       store.ts (Zustand), persistence.ts (IndexedDB)
backend/app    main.py (FastAPI), pipeline.py (Demucs + librosa + clasificador)
```

### Sincronización (la parte crítica)

- **Un solo reloj**: `songPos(t) = ancla.songPos + (t − ancla.ctxTime) · rate`, con `t` = reloj del AudioContext. Play, salto, cambio de velocidad y vuelta de bucle crean anclas; el salto de bucle se programa con exactitud de muestra.
- **Scheduler con lookahead** (temporizador cada 25 ms, programa 200 ms por delante en ventanas semiabiertas): metrónomo, cuenta previa y sonidos guía se programan en tiempos exactos del reloj de audio. Cada golpe se programa una sola vez aunque el temporizador se retrase o el usuario salte.
- **Lo visual** se calcula en cada `requestAnimationFrame` a partir de la posición **audible** (`getOutputTimestamp`, o si no existe, `currentTime − outputLatency`) más la calibración del usuario. Batería, partitura, carril y contador leen la misma posición en el mismo frame. No hay setTimeout por golpe ni re-render de React por frame: solo se escriben `transform`/`opacity`.
- **Velocidad 50–150 % sin cambiar el tono**: WSOLA propio en un Web Worker, con bloqueo de transitorios para no perder golpes. Mientras se calcula, se reproduce con cambio de tono y después se sustituye sin mover el reloj.
- **Offset audio↔partitura** y **escala de tempo** en el panel de sincronía (con forma de onda y marcas de compás).

Mediciones en el navegador (Chromium, Mac, 60 Hz): 43/43 golpes al 100 % y 61/61 al 75 % iluminaron exactamente su pieza; retraso visual máximo de 10,7 ms y 14,8 ms (menos de un frame); 0 sonidos programados tarde. En el iPad (120 Hz) el límite esperado es ~8 ms; mídelo con el panel de diagnóstico.

---

## Estado

### Implementado y verificado

- Batería SVG reconstruida (8 piezas independientes, colores y distribución de la referencia). El bombo se representa solo con el pedal central; los golpes del pie izquierdo (pedal de hi-hat) se muestran en el hi-hat. Golpe: brillo instantáneo, agrandamiento del 12 % sobre su centro, pulso; duración configurable (150 ms por defecto); golpes simultáneos; `triggerDrum(instrument, velocity)`; clic o toque con sonido; secuencia demo de 8 tiempos.
- Canción demo original (16 compases, 100 BPM, ghost notes, tresillos, secciones, variante de principiante escrita a mano), con audio sintetizado y alineado exactamente.
- Modo A: importación de MIDI (selección de pistas, mapeo GM/Roland editable, notas sin asignar visibles), MusicXML y Guitar Pro (vía alphaTab, incluidas secciones). Asociación de audio (MP3/WAV/FLAC/M4A) a una partitura, con offset y escala de tempo.
- Partitura alphaTab horizontal: sigue la música, resalta el golpe actual, cabezas en el color de cada pieza, fantasmas y acentos, zoom, toque en un compás para saltar a él, bucle visible.
- Vista simplificada (carriles de colores), alternable con la partitura o ambas a la vez.
- Herramientas: velocidad, metrónomo, cuenta previa de 4, bucle de compases y por secciones, volúmenes independientes (canción / stems de batería y acompañamiento / metrónomo / sonidos guía), etiquetas de manos y pies (diestro/zurdo), anillo de anticipación del próximo golpe, niveles principiante/intermedio/avanzado.
- Editor: añadir, eliminar, arrastrar (tiempo y pieza), velocity, articulación, cuantizar, BPM y compás, deshacer/rehacer, guardar, exportar MIDI/JSON/MusicXML. Comparte los mismos eventos que el reproductor. Indica el origen de cada golpe (demo/MIDI/partitura/IA/manual) y la confianza de la IA.
- Persistencia local (IndexedDB) de canciones, audio y ajustes. Tema claro/oscuro/sistema. PWA.
- Modo B: servicio FastAPI con progreso, separación con Demucs, tempo, primer tiempo fuerte, ataques, clasificación, stems descargables; desde la app crea una canción editable con los golpes marcados como IA.

### Limitaciones conocidas (no ocultas)

- **Cuantización**: una rejilla por pulso (binaria hasta fusas, o tresillos/seisillos); sin quintillos ni grupos que crucen el pulso. Las repeticiones de MusicXML/GP no se expanden. Las anacrusas se tratan como compás completo.
- **Niveles**: si la canción no trae una variante de autor, el nivel es una *reducción* (quita golpes, nunca los inventa) y se indica en pantalla.
- **Transcripción**: el clasificador es heurístico (bandas, decaimiento y tono), sin modelo entrenado. Sobre la demo sintética: con la batería aislada, F ≈ 0,77–1,0 por pieza; con la mezcla + Demucs, bombo 0,97, hi-hat 0,85, caja 0,71 y ride 0,63; el pedal de hi-hat no se detecta. Con grabaciones reales será peor, sobre todo en toms y platillos. El tempo puede salir con un factor erróneo (en la muestra funk salió 127,6 en vez de 96): el editor tiene botones ×½ ×¾ ×4⁄3 ×2 que corrigen sin mover los golpes detectados.
- Sincronía audio↔partitura: offset fijo + escala de tempo global. Grabaciones sin claqueta con tempo variable necesitan un mapa de tempo (pendiente).
- El bundle es grande (alphaTab ~2 MB); se carga una vez y queda en caché.

### Pendiente

- Evaluar lo que toca el usuario (entrada MIDI de batería electrónica o micrófono) usando la latencia ya calibrada.
- Modelo de transcripción entrenado (p. ej. ADTOF u Omnizart) que sustituya al heurístico; antes hay que revisar sus licencias y pesos.
- Alineación automática partitura↔audio con tempo variable (DTW).
- Expansión de repeticiones, figuras irregulares y cambios de tempo dentro del compás.
- Variantes de dificultad de autor para canciones importadas.

---

## Criterios de aceptación: cómo comprobarlos

1–5. Al abrir la app se carga la demo. Play → suena la música, se iluminan y agrandan las piezas, la partitura y el carril avanzan.
6. Pausa y Play: continúa en la misma posición audible.
7. Toca un compás en la partitura (o ⏮ ⏭).
8. Mueve "Velocidad" (se aplica al soltar).
9. Biblioteca → «MIDI nuevo (funk humanizado)», o Importar con cualquier `.mid`.
10. Biblioteca → «MIDI + audio (desfasado 1,5 s)» → se abre el ajuste de sincronía: toca la forma de onda en el primer golpe y pulsa «Fijar compás 1 aquí» (o +100 ms ×15).

Transcripción (validada por separado): `./start.sh --backend`, después Ajustes → Transcripción automática.
