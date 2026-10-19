/**
 * SpectroDraw - Motor de síntesis y resíntesis de espectrograma
 */

class SpectroAudioEngine {
  constructor() {
    this.audioCtx = null;
    this.masterGain = null;
    this.liveOsc = null;
    this.liveGain = null;
    this.isPlaying = false;
    this.minFreq = 50;     // Hz (fondo del canvas)
    this.maxFreq = 10000;  // Hz (techo del canvas)
    this.activeNodes = [];
    this.waveform = 'sine';
    this.numBands = 80;    // Resolución vertical de osciladores para resíntesis
  }

  ensureContext() {
    if (!this.audioCtx) {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioCtxClass();
      this.masterGain = this.audioCtx.createGain();
      this.masterGain.gain.value = 0.8;
      this.masterGain.connect(this.audioCtx.destination);
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  setMasterVolume(val) {
    if (this.masterGain) {
      this.masterGain.gain.setValueAtTime(val, this.audioCtx.currentTime);
    }
  }

  setWaveform(type) {
    this.waveform = type;
  }

  // Mapeo logarítmico: Y (0 = arriba/maxFreq, 1 = abajo/minFreq)
  yToFreq(yNorm) {
    const clampedY = Math.max(0, Math.min(1, yNorm));
    const ratio = 1 - clampedY;
    return this.minFreq * Math.pow(this.maxFreq / this.minFreq, ratio);
  }

  freqToY(freq) {
    const ratio = Math.log(freq / this.minFreq) / Math.log(this.maxFreq / this.minFreq);
    return 1 - ratio;
  }

  // Convertir frecuencia a nota MIDI y cuantizar a la escala seleccionada
  quantizeFreq(rawFreq, scaleType = 'chromatic') {
    if (scaleType === 'free') return rawFreq;

    // Número de nota MIDI más cercana
    const midiFloat = 69 + 12 * Math.log2(rawFreq / 440);
    let nearestMidi = Math.round(midiFloat);

    if (scaleType !== 'chromatic') {
      const pitchClass = ((nearestMidi % 12) + 12) % 12;
      // Do mayor: C(0), D(2), E(4), F(5), G(7), A(9), B(11)
      const majorScale = [0, 2, 4, 5, 7, 9, 11];
      // La menor: A(9), B(11), C(0), D(2), E(4), F(5), G(7)
      const minorScale = [0, 2, 3, 5, 7, 8, 10];
      // Pentatónica mayor: C(0), D(2), E(4), G(7), A(9)
      const pentatonic = [0, 2, 4, 7, 9];

      let allowed = majorScale;
      if (scaleType === 'minor') allowed = minorScale;
      if (scaleType === 'pentatonic') allowed = pentatonic;

      // Buscar nota permitida más próxima
      let bestDiff = 999;
      let bestMidi = nearestMidi;
      for (let offset = -2; offset <= 2; offset++) {
        const candidate = nearestMidi + offset;
        const cClass = ((candidate % 12) + 12) % 12;
        if (allowed.includes(cClass)) {
          const diff = Math.abs(candidate - midiFloat);
          if (diff < bestDiff) {
            bestDiff = diff;
            bestMidi = candidate;
          }
        }
      }
      nearestMidi = bestMidi;
    }

    // Frecuencia exacta de la nota musical afinada
    return 440 * Math.pow(2, (nearestMidi - 69) / 12);
  }

  // Obtener nombre legible de nota (ej: C4, F#3, A4)
  freqToNoteName(freq) {
    const noteNames = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];
    const midi = Math.round(69 + 12 * Math.log2(freq / 440));
    const noteIndex = ((midi % 12) + 12) % 12;
    const octave = Math.floor(midi / 12) - 1;
    return `${noteNames[noteIndex]}${octave}`;
  }

  // Preescucha interactiva en vivo
  startLiveTone(freq, volume = 0.25) {
    this.ensureContext();
    if (!this.liveOsc) {
      this.liveOsc = this.audioCtx.createOscillator();
      this.liveGain = this.audioCtx.createGain();
      this.liveOsc.type = this.waveform;
      this.liveOsc.frequency.setValueAtTime(freq, this.audioCtx.currentTime);
      this.liveGain.gain.setValueAtTime(volume, this.audioCtx.currentTime);

      this.liveOsc.connect(this.liveGain);
      this.liveGain.connect(this.masterGain);
      this.liveOsc.start();
    } else {
      this.updateLiveTone(freq, volume);
    }
  }

  updateLiveTone(freq, volume = 0.25) {
    if (this.liveOsc && this.liveGain) {
      const now = this.audioCtx.currentTime;
      this.liveOsc.type = this.waveform;
      this.liveOsc.frequency.cancelScheduledValues(now);
      this.liveOsc.frequency.setTargetAtTime(freq, now, 0.015);
      this.liveGain.gain.cancelScheduledValues(now);
      this.liveGain.gain.setTargetAtTime(volume, now, 0.02);
    }
  }

  stopLiveTone() {
    if (this.liveGain) {
      const now = this.audioCtx.currentTime;
      this.liveGain.gain.cancelScheduledValues(now);
      this.liveGain.gain.setTargetAtTime(0, now, 0.03);
      setTimeout(() => {
        if (this.liveOsc) {
          try { this.liveOsc.stop(); } catch (e) {}
          this.liveOsc.disconnect();
          this.liveGain.disconnect();
          this.liveOsc = null;
          this.liveGain = null;
        }
      }, 50);
    }
  }

  // Resíntesis interactiva en tiempo real (lee el lienzo continuamente en cada pasada del cabezal)
  startSweepPlayback(getCanvasColumnData, duration, onProgress, onEnded, loop = false) {
    this.ensureContext();
    this.stopSweepPlayback();
    this.isPlaying = true;

    const ctx = this.audioCtx;
    const bands = this.numBands;
    const oscNodes = [];

    // Banco permanente de osciladores para barrido en vivo
    for (let b = 0; b < bands; b++) {
      const yNorm = b / (bands - 1);
      const freq = this.yToFreq(yNorm);
      const osc = ctx.createOscillator();
      const gainNode = ctx.createGain();

      osc.type = this.waveform;
      osc.frequency.value = freq;
      gainNode.gain.setValueAtTime(0, ctx.currentTime);

      osc.connect(gainNode);
      gainNode.connect(this.masterGain);
      osc.start();

      oscNodes.push({ osc, gainNode, freq, yNorm });
    }

    this.activeNodes = oscNodes;

    let startTime = performance.now();

    const updateLoop = (now) => {
      if (!this.isPlaying) return;

      const elapsedSec = (now - startTime) / 1000;
      let progress = elapsedSec / duration;

      if (progress >= 1) {
        if (loop) {
          startTime = now;
          progress = 0;
        } else {
          this.stopSweepPlayback();
          onProgress(0);
          if (onEnded) onEnded();
          return;
        }
      }

      onProgress(progress);

      // Obtener columnas de píxeles actuales del lienzo en tiempo real
      const colData = getCanvasColumnData(progress);
      if (colData) {
        const { height, pixels } = colData;
        const audioTime = ctx.currentTime;
        const rampDuration = 0.025; // 25ms para transición ultra suave sin clics

        // Detectar intensidades de cada banda
        for (let b = 0; b < bands; b++) {
          const { gainNode, yNorm } = oscNodes[b];
          const py = Math.floor(yNorm * (height - 1));
          
          let intensity = 0;
          let count = 0;
          const windowSize = Math.max(1, Math.floor(height / bands / 2));

          for (let dy = -windowSize; dy <= windowSize; dy++) {
            const cy = py + dy;
            if (cy >= 0 && cy < height) {
              const idx = cy * 4;
              const r = pixels[idx];
              const g = pixels[idx + 1];
              const bVal = pixels[idx + 2];
              if (r > 15 || g > 15 || bVal > 22) {
                const lum = (0.299 * r + 0.587 * g + 0.114 * bVal) / 255;
                intensity += lum;
              }
              count++;
            }
          }

          let avgIntensity = count > 0 ? (intensity / count) : 0;
          // Noise-gate y curva tonal agradable
          if (avgIntensity < 0.06) {
            avgIntensity = 0;
          } else {
            // Curva cuadrática para destacar el centro de la línea y silenciar bordes difusos
            avgIntensity = Math.pow(avgIntensity, 1.6);
          }

          const targetGain = avgIntensity * 0.22;
          gainNode.gain.cancelScheduledValues(audioTime);
          gainNode.gain.setTargetAtTime(targetGain, audioTime, rampDuration);
        }
      }

      this.currentAnimFrame = requestAnimationFrame(updateLoop);
    };

    this.currentAnimFrame = requestAnimationFrame(updateLoop);
  }

  stopSweepPlayback() {
    this.isPlaying = false;
    if (this.currentAnimFrame) {
      cancelAnimationFrame(this.currentAnimFrame);
      this.currentAnimFrame = null;
    }
    if (this.activeNodes && this.activeNodes.length > 0) {
      const now = this.audioCtx ? this.audioCtx.currentTime : 0;
      this.activeNodes.forEach(({ osc, gainNode }) => {
        try {
          if (gainNode) {
            gainNode.gain.cancelScheduledValues(now);
            gainNode.gain.setValueAtTime(0, now);
          }
          osc.stop(now + 0.05);
          setTimeout(() => {
            try {
              osc.disconnect();
              gainNode.disconnect();
            } catch (e) {}
          }, 60);
        } catch (e) {}
      });
      this.activeNodes = [];
    }
  }

  // Exportar a archivo WAV estéreo/mono
  async exportToWav(spectroData, duration) {
    const sampleRate = 44100;
    const length = Math.floor(sampleRate * duration);
    const offlineCtx = new OfflineAudioContext(1, length, sampleRate);

    const { width, height, data } = spectroData;
    const bands = this.numBands;
    const maxBandGain = 0.8 / Math.sqrt(bands);

    for (let b = 0; b < bands; b++) {
      const yNorm = b / (bands - 1);
      const freq = this.yToFreq(yNorm);
      const osc = offlineCtx.createOscillator();
      const gainNode = offlineCtx.createGain();

      osc.type = this.waveform;
      osc.frequency.value = freq;
      gainNode.gain.setValueAtTime(0, 0);

      const timeSteps = Math.min(width, 240);
      const dt = duration / timeSteps;
      const py = Math.floor(yNorm * (height - 1));

      for (let s = 0; s <= timeSteps; s++) {
        const t = (s * dt);
        const px = Math.min(width - 1, Math.floor((s / timeSteps) * width));
        
        let intensity = 0;
        let count = 0;
        const windowSize = Math.max(1, Math.floor(height / bands / 2));

        for (let dy = -windowSize; dy <= windowSize; dy++) {
          const cy = py + dy;
          if (cy >= 0 && cy < height) {
            const idx = (cy * width + px) * 4;
            const r = data[idx];
            const g = data[idx + 1];
            const bVal = data[idx + 2];
            if (r > 15 || g > 15 || bVal > 22) {
              const lum = (0.299 * r + 0.587 * g + 0.114 * bVal) / 255;
              intensity += lum;
            }
            count++;
          }
        }

        let avgIntensity = count > 0 ? (intensity / count) : 0;
        if (avgIntensity < 0.05) avgIntensity = 0;

        const finalAmp = avgIntensity * maxBandGain;
        gainNode.gain.setValueAtTime(finalAmp, t);
      }

      osc.connect(gainNode);
      gainNode.connect(offlineCtx.destination);
      osc.start(0);
      osc.stop(duration);
    }

    const renderedBuffer = await offlineCtx.startRendering();
    return this.audioBufferToWavBlob(renderedBuffer);
  }

  audioBufferToWavBlob(buffer) {
    const numOfChan = buffer.numberOfChannels;
    const length = buffer.length * numOfChan * 2 + 44;
    const out = new DataView(new ArrayBuffer(length));
    const channels = [];
    let sample = 0;
    let offset = 0;
    let pos = 0;

    function setUint16(data) { out.setUint16(pos, data, true); pos += 2; }
    function setUint32(data) { out.setUint32(pos, data, true); pos += 4; }

    // RIFF chunk descriptor
    setUint32(0x46464952); // "RIFF"
    setUint32(length - 8);
    setUint32(0x45564157); // "WAVE"
    // FMT sub-chunk
    setUint32(0x20746d66); // "fmt "
    setUint32(16);         // SubChunk1Size (16 for PCM)
    setUint16(1);          // AudioFormat (1 for PCM)
    setUint16(numOfChan);
    setUint32(buffer.sampleRate);
    setUint32(buffer.sampleRate * 2 * numOfChan); // ByteRate
    setUint16(numOfChan * 2);                    // BlockAlign
    setUint16(16);                               // BitsPerSample
    // Data sub-chunk
    setUint32(0x61746164); // "data"
    setUint32(length - pos - 4);

    for (let i = 0; i < buffer.numberOfChannels; i++) {
      channels.push(buffer.getChannelData(i));
    }

    while (offset < buffer.length) {
      for (let i = 0; i < numOfChan; i++) {
        sample = Math.max(-1, Math.min(1, channels[i][offset]));
        sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
        out.setInt16(pos, sample, true);
        pos += 2;
      }
      offset++;
    }

    return new Blob([out], { type: 'audio/wav' });
  }
}

window.SpectroAudioEngine = SpectroAudioEngine;
