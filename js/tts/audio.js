// Shared audio playback for engines that return raw audio (Kokoro, voice server).
// Pitch shift without tempo change: we synthesize at speed/factor, then play with
// detune (which raises pitch AND tempo by `factor`), so the net tempo is `speed`.

let ctx;
export function audioContext() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  return ctx;
}

export const pitchFactor = (semitones) => Math.pow(2, (semitones || 0) / 12);

export class AudioPlayer {
  constructor() {
    this.source = null;
    this.gain = null;
    this._resolve = null;
  }

  async play(buffer, { pitch = 0, volume = 1, onProgress } = {}) {
    const ac = audioContext();
    if (ac.state === 'suspended') await ac.resume();
    this.stop();
    return new Promise((resolve) => {
      const src = ac.createBufferSource();
      src.buffer = buffer;
      src.detune.value = (pitch || 0) * 100;
      const gain = ac.createGain();
      gain.gain.value = volume;
      src.connect(gain).connect(ac.destination);
      this.source = src;
      this.gain = gain;
      this._resolve = resolve;
      const factor = pitchFactor(pitch);
      const startedAt = ac.currentTime;
      let raf;
      if (onProgress) {
        const tick = () => {
          if (this.source !== src) return;
          const t = (ac.currentTime - startedAt) * factor;
          onProgress(Math.min(1, t / buffer.duration));
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      }
      src.onended = () => {
        cancelAnimationFrame(raf);
        if (this.source === src) this.source = null;
        resolve(true);
      };
      src.start();
    });
  }

  stop() {
    if (this.source) {
      const s = this.source;
      this.source = null;
      try { s.onended = null; s.stop(); } catch {}
      this._resolve?.(false);
    }
  }

  async pause() { await audioContext().suspend(); }
  async resume() { await audioContext().resume(); }
}

export function floatToBuffer(samples, sampleRate) {
  const ac = audioContext();
  const buf = ac.createBuffer(1, samples.length, sampleRate);
  buf.copyToChannel(samples, 0);
  return buf;
}

// Decode any audio the browser understands (webm/opus from the mic, mp3, m4a…) and
// re-encode it as 16-bit mono WAV, which every voice model can read.
export async function toWav(blob) {
  const ac = audioContext();
  const buf = await ac.decodeAudioData(await blob.arrayBuffer());
  const n = buf.length;
  const mono = new Float32Array(n);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) mono[i] += d[i] / buf.numberOfChannels;
  }
  const out = new DataView(new ArrayBuffer(44 + n * 2));
  const w = (o, s) => [...s].forEach((ch, i) => out.setUint8(o + i, ch.charCodeAt(0)));
  w(0, 'RIFF'); out.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, 1, true);
  out.setUint32(24, buf.sampleRate, true); out.setUint32(28, buf.sampleRate * 2, true);
  out.setUint16(32, 2, true); out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, mono[i])) * 0x7fff, true);
  return { blob: new Blob([out], { type: 'audio/wav' }), seconds: buf.duration };
}
