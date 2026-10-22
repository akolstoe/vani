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
