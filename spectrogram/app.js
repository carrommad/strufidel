/**
 * SpectroDraw - Controlador de interfaz, lienzo y herramientas
 */

document.addEventListener('DOMContentLoaded', () => {
  const audio = new SpectroAudioEngine();

  // Elementos del DOM
  const spectroCanvas = document.getElementById('spectro-canvas');
  const overlayCanvas = document.getElementById('overlay-canvas');
  const spectroCtx = spectroCanvas.getContext('2d', { willReadFrequently: true });
  const overlayCtx = overlayCanvas.getContext('2d');

  const btnBrush = document.getElementById('tool-brush');
  const btnHighlighter = document.getElementById('tool-highlighter');
  const btnEraser = document.getElementById('tool-eraser');
  const btnClear = document.getElementById('btn-clear');

  const brushSizeInput = document.getElementById('brush-size');
  const valBrushSize = document.getElementById('val-brush-size');
  const chkLivePreview = document.getElementById('chk-live-preview');
  const selectScale = document.getElementById('select-scale');

  const btnPlay = document.getElementById('btn-play');
  const btnStop = document.getElementById('btn-stop');
  const iconPlay = document.getElementById('icon-play');
  const iconPause = document.getElementById('icon-pause');
  const textPlay = document.getElementById('text-play');
  const chkLoop = document.getElementById('chk-loop');

  const sliderDuration = document.getElementById('slider-duration');
  const valDuration = document.getElementById('val-duration');
  const sliderVolume = document.getElementById('slider-volume');
  const valVolume = document.getElementById('val-volume');
  const selectWaveform = document.getElementById('select-waveform');
  const btnExportWav = document.getElementById('btn-export-wav');

  // Controles de zoom vertical
  const btnZoomIn = document.getElementById('btn-zoom-in');
  const btnZoomOut = document.getElementById('btn-zoom-out');
  const btnZoomReset = document.getElementById('btn-zoom-reset');
  const valZoom = document.getElementById('val-zoom');
  const freqAxisContainer = document.getElementById('freq-axis-container');

  // Estado de zoom: 1x (rango total) hasta 8x (máxima resolución de semitonos)
  let zoomLevel = 1;
  let zoomCenterNormY = 0.5; // Centro del zoom en la escala vertical normalizada [0, 1]

  // Convertir Y de pantalla a Y global normalizada [0, 1] y viceversa
  function screenToGlobalNormY(screenNormY) {
    const span = 1 / zoomLevel;
    const top = Math.max(0, Math.min(1 - span, zoomCenterNormY - span / 2));
    return top + screenNormY * span;
  }

  function globalToScreenNormY(globalNormY) {
    const span = 1 / zoomLevel;
    const top = Math.max(0, Math.min(1 - span, zoomCenterNormY - span / 2));
    return (globalNormY - top) / span;
  }

  // Lista de las 12 notas de la octava
  const noteNamesChromatic = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];
  const majorIndices = [0, 2, 4, 5, 7, 9, 11];
  const minorIndices = [0, 2, 3, 5, 7, 8, 10];
  const pentatonicIndices = [0, 2, 4, 7, 9];

  // Generar lista completa de notas audibles (MIDI 24 = C1 ~32Hz a MIDI 108 = C8 ~4186Hz)
  const allScaleNotes = [];
  for (let midi = 24; midi <= 108; midi++) {
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const pitchClass = ((midi % 12) + 12) % 12;
    const octave = Math.floor(midi / 12) - 1;
    const isAccidental = [1, 3, 6, 8, 10].includes(pitchClass);
    const name = `${noteNamesChromatic[pitchClass]}${octave}`;
    allScaleNotes.push({
      midi,
      freq,
      pitchClass,
      name,
      isAccidental,
      globalY: audio.freqToY(freq)
    });
  }

  // Inicializar fondo oscuro en el lienzo del espectrograma
  function initCanvas() {
    spectroCtx.fillStyle = '#090a0f';
    spectroCtx.fillRect(0, 0, spectroCanvas.width, spectroCanvas.height);
    drawGrid();
  }

  function updateFreqAxis(visibleNotes) {
    if (!freqAxisContainer) return;
    freqAxisContainer.innerHTML = '';
    // Seleccionar entre 6 y 10 notas representativas bien espaciadas
    const count = Math.min(visibleNotes.length, 8);
    const step = Math.max(1, Math.floor(visibleNotes.length / count));
    for (let i = 0; i < visibleNotes.length; i += step) {
      const n = visibleNotes[i];
      const span = document.createElement('span');
      span.textContent = `${n.name} (${Math.round(n.freq)}Hz)`;
      freqAxisContainer.appendChild(span);
    }
  }

  function drawGrid() {
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    const currentScale = selectScale.value;

    // Filtrar qué notas pertenecen a la escala actual
    const visibleNotes = allScaleNotes.filter(n => {
      // Filtrar si pertenece a la escala
      if (currentScale === 'major' && !majorIndices.includes(n.pitchClass)) return false;
      if (currentScale === 'minor' && !minorIndices.includes(n.pitchClass)) return false;
      if (currentScale === 'pentatonic' && !pentatonicIndices.includes(n.pitchClass)) return false;

      // Filtrar si está dentro de la ventana de zoom
      const screenY = globalToScreenNormY(n.globalY);
      return screenY >= -0.05 && screenY <= 1.05;
    });

    if (currentScale !== 'free') {
      visibleNotes.forEach(n => {
        const screenY = globalToScreenNormY(n.globalY) * overlayCanvas.height;
        const isDo = n.pitchClass === 0;
        const isLa = n.pitchClass === 9;

        // Estilo de línea según importancia
        if (isDo) {
          overlayCtx.strokeStyle = 'rgba(99, 102, 241, 0.7)'; // Do tónica destacada
          overlayCtx.lineWidth = 1.8;
        } else if (n.isAccidental) {
          overlayCtx.strokeStyle = 'rgba(255, 255, 255, 0.08)'; // Teclas negras / sostenidos
          overlayCtx.lineWidth = 0.8;
        } else {
          overlayCtx.strokeStyle = 'rgba(255, 255, 255, 0.22)'; // Teclas blancas / notas naturales
          overlayCtx.lineWidth = 1.2;
        }

        overlayCtx.beginPath();
        overlayCtx.moveTo(0, screenY);
        overlayCtx.lineTo(overlayCanvas.width, screenY);
        overlayCtx.stroke();

        // Etiqueta legible de la nota en la cuadrícula
        if (zoomLevel >= 2 || isDo || isLa || visibleNotes.length < 25) {
          overlayCtx.fillStyle = isDo ? '#a5b4fc' : (n.isAccidental ? '#6b7280' : '#e5e7eb');
          overlayCtx.font = `${zoomLevel >= 4 ? 12 : 10}px Inter, monospace`;
          overlayCtx.fillText(n.name, 12, screenY - 4);
        }
      });
      updateFreqAxis(visibleNotes);
    } else {
      // Modo libre: líneas de frecuencia continuas
      [100, 200, 440, 1000, 2500, 5000].forEach(f => {
        const globalY = audio.freqToY(f);
        const screenY = globalToScreenNormY(globalY) * overlayCanvas.height;
        if (screenY >= 0 && screenY <= overlayCanvas.height) {
          overlayCtx.strokeStyle = 'rgba(168, 85, 247, 0.3)';
          overlayCtx.lineWidth = 1;
          overlayCtx.beginPath();
          overlayCtx.moveTo(0, screenY);
          overlayCtx.lineTo(overlayCanvas.width, screenY);
          overlayCtx.stroke();
          overlayCtx.fillStyle = '#c084fc';
          overlayCtx.font = '10px Inter, monospace';
          overlayCtx.fillText(`${f} Hz`, 12, screenY - 4);
        }
      });
    }

    // Líneas verticales de división temporal
    const steps = 8;
    overlayCtx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    overlayCtx.lineWidth = 1;
    for (let i = 1; i < steps; i++) {
      const x = (overlayCanvas.width / steps) * i;
      overlayCtx.beginPath();
      overlayCtx.moveTo(x, 0);
      overlayCtx.lineTo(x, overlayCanvas.height);
      overlayCtx.stroke();
    }
  }

  function drawPlayhead(progress) {
    drawGrid();
    if (progress > 0 && progress <= 1) {
      const x = progress * overlayCanvas.width;
      overlayCtx.strokeStyle = '#38bdf8';
      overlayCtx.lineWidth = 2.5;
      overlayCtx.shadowColor = 'rgba(56, 189, 248, 0.8)';
      overlayCtx.shadowBlur = 8;
      overlayCtx.beginPath();
      overlayCtx.moveTo(x, 0);
      overlayCtx.lineTo(x, overlayCanvas.height);
      overlayCtx.stroke();
      overlayCtx.shadowBlur = 0; // reset
    }
  }

  initCanvas();

  // Posición del ratón ajustada a resolución interna del Canvas
  function getCanvasPos(e) {
    const rect = spectroCanvas.getBoundingClientRect();
    const scaleX = spectroCanvas.width / rect.width;
    const scaleY = spectroCanvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
      normY: (e.clientY - rect.top) / rect.height
    };
  }

  // Estado de las herramientas de dibujo
  let currentTool = 'brush';
  let isDrawing = false;
  let lastX = 0;
  let lastY = 0;

  // Selección de herramientas
  const toolButtons = [btnBrush, btnHighlighter, btnEraser];
  function setTool(tool, button) {
    currentTool = tool;
    toolButtons.forEach(b => b.classList.remove('active'));
    button.classList.add('active');
  }

  btnBrush.addEventListener('click', () => setTool('brush', btnBrush));
  btnHighlighter.addEventListener('click', () => setTool('highlighter', btnHighlighter));
  btnEraser.addEventListener('click', () => setTool('eraser', btnEraser));

  brushSizeInput.addEventListener('input', (e) => {
    valBrushSize.textContent = e.target.value;
  });

  btnClear.addEventListener('click', () => {
    initCanvas();
  });

  // Eventos de botones de zoom
  function updateZoom(newZoom) {
    zoomLevel = Math.max(1, Math.min(8, newZoom));
    valZoom.textContent = `${zoomLevel}x`;
    drawGrid();
  }

  btnZoomIn.addEventListener('click', () => updateZoom(zoomLevel * 2));
  btnZoomOut.addEventListener('click', () => updateZoom(zoomLevel / 2));
  btnZoomReset.addEventListener('click', () => {
    zoomCenterNormY = 0.5;
    updateZoom(1);
  });

  // Re-dibujar cuadrícula inmediatamente al cambiar la escala
  selectScale.addEventListener('change', () => {
    drawGrid();
  });

  // Rueda del ratón sobre el canvas para hacer zoom o desplazarse
  spectroCanvas.parentElement.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      // Zoom in/out con rueda
      const zoomFactor = e.deltaY < 0 ? 1.25 : 0.8;
      updateZoom(zoomLevel * zoomFactor);
    } else {
      // Desplazamiento vertical (pan)
      const span = 1 / zoomLevel;
      const delta = (e.deltaY / 480) * span;
      zoomCenterNormY = Math.max(span / 2, Math.min(1 - span / 2, zoomCenterNormY + delta));
      drawGrid();
    }
  }, { passive: false });

  // Obtener coordenada Y ajustada a la nota musical teniendo en cuenta el zoom vertical
  function snapYToScale(screenNormY) {
    const scale = selectScale.value;
    const globalNormY = screenToGlobalNormY(screenNormY);

    if (scale === 'free') {
      return {
        screenNormY,
        globalNormY,
        freq: audio.yToFreq(globalNormY)
      };
    }

    const rawFreq = audio.yToFreq(globalNormY);
    const quantizedFreq = audio.quantizeFreq(rawFreq, scale);
    const snappedGlobalY = audio.freqToY(quantizedFreq);
    const snappedScreenY = globalToScreenNormY(snappedGlobalY);

    return {
      screenNormY: snappedScreenY,
      globalNormY: snappedGlobalY,
      freq: quantizedFreq
    };
  }

  // Trazado en el canvas
  function startDraw(e) {
    isDrawing = true;
    const { x, normY } = getCanvasPos(e);
    const snapped = snapYToScale(normY);
    const y = snapped.screenNormY * spectroCanvas.height;

    lastX = x;
    lastY = y;

    if (chkLivePreview.checked) {
      const amp = currentTool === 'highlighter' ? 0.12 : (currentTool === 'eraser' ? 0 : 0.25);
      if (amp > 0) audio.startLiveTone(snapped.freq, amp);
    }

    drawSegment(x, y);
  }

  function moveDraw(e) {
    const { x, normY } = getCanvasPos(e);
    const snapped = snapYToScale(normY);
    const y = snapped.screenNormY * spectroCanvas.height;

    if (chkLivePreview.checked) {
      const amp = currentTool === 'highlighter' ? 0.12 : (currentTool === 'eraser' ? 0 : 0.25);
      if (isDrawing && amp > 0) {
        audio.updateLiveTone(snapped.freq, amp);
      }
    }

    if (!isDrawing) return;
    drawSegment(x, y);
    lastX = x;
    lastY = y;
  }

  function stopDraw() {
    if (isDrawing) {
      isDrawing = false;
      audio.stopLiveTone();
    }
  }

  function drawSegment(toX, toY) {
    const size = parseInt(brushSizeInput.value, 10);
    spectroCtx.lineCap = 'round';
    spectroCtx.lineJoin = 'round';
    spectroCtx.lineWidth = size;

    if (currentTool === 'brush') {
      spectroCtx.globalCompositeOperation = 'source-over';
      // Gradiente cálido según altura espectral (tonos anaranjados/cian vibrantes)
      const grad = spectroCtx.createLinearGradient(0, 0, 0, spectroCanvas.height);
      grad.addColorStop(0, '#f43f5e');
      grad.addColorStop(0.5, '#ec4899');
      grad.addColorStop(1, '#6366f1');
      spectroCtx.strokeStyle = grad;
    } else if (currentTool === 'highlighter') {
      spectroCtx.globalCompositeOperation = 'source-over';
      spectroCtx.strokeStyle = 'rgba(234, 179, 8, 0.28)';
    } else if (currentTool === 'eraser') {
      spectroCtx.globalCompositeOperation = 'source-over';
      spectroCtx.strokeStyle = '#090a0f';
    }

    spectroCtx.beginPath();
    spectroCtx.moveTo(lastX, lastY);
    spectroCtx.lineTo(toX, toY);
    spectroCtx.stroke();
  }

  spectroCanvas.addEventListener('pointerdown', startDraw);
  spectroCanvas.addEventListener('pointermove', moveDraw);
  window.addEventListener('pointerup', stopDraw);
  spectroCanvas.addEventListener('pointerleave', () => {
    if (!isDrawing) audio.stopLiveTone();
  });

  // Controles de reproducción
  function updatePlayButton(isPlaying) {
    if (isPlaying) {
      iconPlay.classList.add('hidden');
      iconPause.classList.remove('hidden');
      textPlay.textContent = 'Pausar';
    } else {
      iconPlay.classList.remove('hidden');
      iconPause.classList.add('hidden');
      textPlay.textContent = 'Reproducir';
    }
  }

  function togglePlay() {
    if (audio.isPlaying) {
      audio.stopSweepPlayback();
      updatePlayButton(false);
      drawPlayhead(0);
    } else {
      const duration = parseFloat(sliderDuration.value);
      const loop = chkLoop.checked;

      // Proveedor en vivo de la columna por donde pasa el cabezal en cada milisegundo
      const getCanvasColumnData = (progress) => {
        const x = Math.min(spectroCanvas.width - 1, Math.max(0, Math.floor(progress * spectroCanvas.width)));
        // Leer una delgada franja de 2px de ancho para máxima precisión y velocidad
        const col = spectroCtx.getImageData(x, 0, 1, spectroCanvas.height);
        return {
          height: spectroCanvas.height,
          pixels: col.data
        };
      };

      updatePlayButton(true);
      audio.startSweepPlayback(
        getCanvasColumnData,
        duration,
        (progress) => drawPlayhead(progress),
        () => {
          updatePlayButton(false);
          drawPlayhead(0);
        },
        loop
      );
    }
  }

  btnPlay.addEventListener('click', togglePlay);

  btnStop.addEventListener('click', () => {
    audio.stopSweepPlayback();
    updatePlayButton(false);
    drawPlayhead(0);
  });

  sliderDuration.addEventListener('input', (e) => {
    valDuration.textContent = e.target.value;
  });

  sliderVolume.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    valVolume.textContent = val;
    audio.setMasterVolume(val / 100);
  });

  selectWaveform.addEventListener('change', (e) => {
    audio.setWaveform(e.target.value);
  });

  // Exportar WAV
  btnExportWav.addEventListener('click', async () => {
    btnExportWav.disabled = true;
    const oldText = btnExportWav.textContent;
    btnExportWav.textContent = 'Renderizando...';

    try {
      const duration = parseFloat(sliderDuration.value);
      const imgData = spectroCtx.getImageData(0, 0, spectroCanvas.width, spectroCanvas.height);
      const blob = await audio.exportToWav(imgData, duration);
      
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `espectrograma_${Date.now()}.wav`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error exportando audio:', err);
    } finally {
      btnExportWav.disabled = false;
      btnExportWav.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Exportar WAV
      `;
    }
  });

  // Generadores didácticos de ejemplos
  const examplePresets = {
    major: {
      scale: 'major',
      draw: () => {
        // Acorde arpegiado brillante Do - Mi - Sol - Do (C4, E4, G4, C5)
        const notes = [261.63, 329.63, 392.00, 523.25, 392.00, 523.25];
        drawNoteSequence(notes);
      }
    },
    minor: {
      scale: 'minor',
      draw: () => {
        // Melodía melancólica La - Do - Mi - Fa - Mi (A3, C4, E4, F4, E4)
        const notes = [220.00, 261.63, 329.63, 349.23, 329.63, 220.00];
        drawNoteSequence(notes);
      }
    },
    pentatonic: {
      scale: 'pentatonic',
      draw: () => {
        // Escala pentatónica fluida Do - Re - Mi - Sol - La - Do5
        const notes = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25];
        drawNoteSequence(notes);
      }
    },
    chromatic: {
      scale: 'chromatic',
      draw: () => {
        // Subida en escalera semitono a semitono (tensión progresiva)
        const notes = [220.00, 233.08, 246.94, 261.63, 277.18, 293.66, 311.13, 329.63];
        drawNoteSequence(notes);
      }
    },
    free: {
      scale: 'free',
      draw: () => {
        // Curva senoidal continua (sirena / sci-fi)
        spectroCtx.strokeStyle = '#a855f7';
        spectroCtx.lineWidth = 14;
        spectroCtx.beginPath();
        const totalPoints = 120;
        for (let i = 0; i <= totalPoints; i++) {
          const x = (spectroCanvas.width * i) / totalPoints;
          const y = spectroCanvas.height * (0.5 + 0.28 * Math.sin((i / totalPoints) * Math.PI * 4));
          if (i === 0) spectroCtx.moveTo(x, y);
          else spectroCtx.lineTo(x, y);
        }
        spectroCtx.stroke();
      }
    }
  };

  function drawNoteSequence(freqList) {
    const num = freqList.length;
    const pad = 40;
    const availableW = spectroCanvas.width - pad * 2;
    const stepW = availableW / num;
    const noteWidth = stepW * 0.75;

    freqList.forEach((freq, idx) => {
      const xStart = pad + idx * stepW;
      const xEnd = xStart + noteWidth;
      const y = audio.freqToY(freq) * spectroCanvas.height;

      spectroCtx.strokeStyle = '#ec4899';
      spectroCtx.lineWidth = 16;
      spectroCtx.lineCap = 'round';
      spectroCtx.beginPath();
      spectroCtx.moveTo(xStart, y);
      spectroCtx.lineTo(xEnd, y);
      spectroCtx.stroke();
    });
  }

  // Asignar clics en tarjetas de ejemplos
  document.querySelectorAll('.example-card').forEach(card => {
    const type = card.getAttribute('data-example');
    card.addEventListener('click', () => {
      const preset = examplePresets[type];
      if (!preset) return;

      // 1. Limpiar lienzo y fondo
      initCanvas();

      // 2. Cambiar selector de escala
      selectScale.value = preset.scale;

      // 3. Dibujar patrón característico
      preset.draw();

      // 4. Iniciar reproducción automática
      if (audio.isPlaying) audio.stopSweepPlayback();
      setTimeout(() => {
        togglePlay();
      }, 100);
    });
  });
});

