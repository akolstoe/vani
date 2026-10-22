// Engine: Piper — small, fast open-source voices (MIT-licensed models, ~60 MB each) that run
// on-device. Less expressive than Kokoro, but several times faster, so it suits phones.
import { chunkText } from './kokoro.js';

const VOICES = [
  ['en_US-hfc_female-medium', 'Hannah', 'American English · F'],
  ['en_US-amy-medium', 'Amy', 'American English · F'],
  ['en_US-lessac-medium', 'Lessac', 'American English · F'],
  ['en_US-hfc_male-medium', 'Harry', 'American English · M'],
  ['en_US-ryan-medium', 'Ryan', 'American English · M'],
  ['en_US-joe-medium', 'Joe', 'American English · M'],
  ['en_GB-alba-medium', 'Alba', 'British English · F'],
  ['en_GB-cori-medium', 'Cori', 'British English · F'],
  ['en_GB-northern_english_male-medium', 'Northern', 'British English · M'],
];
const DEFAULT_VOICE = VOICES[0][0];

let worker = null;
let nextId = 1;
const pending = new Map();
let progressCb = null;
const ready = new Map(); // voice -> Promise
// Plays through an <audio> element, which can change speed without changing pitch.
const player = {
  el: null,
  _resolve: null,
  play(blob, { rate = 1, volume = 1, onProgress } = {}) {
    this.stop();
    const el = new Audio(URL.createObjectURL(blob));
    el.preservesPitch = true;
    el.playbackRate = rate;
    el.volume = volume;
    this.el = el;
    return new Promise((resolve) => {
      this._resolve = resolve;
      let raf;
      const tick = () => {
        if (this.el !== el) return;
        if (el.duration) onProgress?.(Math.min(1, el.currentTime / el.duration));
        raf = requestAnimationFrame(tick);
      };
      const done = (ok) => { cancelAnimationFrame(raf); URL.revokeObjectURL(el.src); if (this.el === el) this.el = null; resolve(ok); };
      el.onended = () => done(true);
      el.onerror = () => done(true);
      el.play().then(() => { if (onProgress) tick(); }).catch(() => done(false));
    });
  },
  stop() {
    const el = this.el;
    if (!el) return;
    this.el = null;
    el.pause();
    el.onended = el.onerror = null;
    this._resolve?.(false);
  },
  pause() { this.el?.pause(); },
  resume() { this.el?.play(); },
};
const cache = new Map();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./piper-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data }) => {
    if (data.type === 'progress') { progressCb?.(data.progress, data.file); return; }
    const p = pending.get(data.id);
    if (!p) return;
    pending.delete(data.id);
    if (data.type === 'error') p.reject(new Error(data.message));
    else p.resolve(data);
  };
  worker.onerror = (e) => {
    const err = new Error(e.message || 'The voice engine crashed');
    pending.forEach((p) => p.reject(err));
    pending.clear();
    worker = null; ready.clear(); piper.loaded = false;
  };
  return worker;
}

function call(msg) {
  const id = nextId++;
  const promise = new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ ...msg, id });
  });
  return { id, promise };
}

export const piper = {
  id: 'piper',
  name: 'Piper (fast, on-device)',
  description: 'Lightweight voices that run quickly even on phones. Each voice downloads once (~60 MB). Less expressive than Kokoro.',
  supportsPitch: false,
  available: () => typeof Worker !== 'undefined',
  loaded: false,
  stats: { ms: 0, audio: 0 },

  init(onProgress, voice = DEFAULT_VOICE) {
    if (onProgress) progressCb = onProgress;
    if (!ready.has(voice)) {
      const p = call({ type: 'init', voice, lib: globalThis.__vaniPiperLib }).promise
        .then(() => { this.loaded = true; })
        .catch((e) => { ready.delete(voice); throw e; });
      ready.set(voice, p);
    }
    return ready.get(voice);
  },

  async voices() {
    return VOICES.map(([id, name, group]) => ({ id, name, lang: id.slice(0, 5).replace('_', '-'), group }));
  },

  _chunk(text, opts, priority = 'later') {
    const voice = opts.voice || DEFAULT_VOICE;
    const key = `${voice}|${text}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const p = this.init(null, voice)
      .then(() => call({ type: 'generate', text, voice, priority }).promise)
      .then((r) => {
        // 16-bit mono WAV: duration = data bytes / (2 * sample rate)
        const dv = new DataView(r.wav);
        const rateHz = dv.getUint32(24, true) || 22050;
        this.stats = { ms: r.ms, audio: Math.max(0, r.wav.byteLength - 44) / (2 * rateHz) };
        return new Blob([r.wav], { type: 'audio/wav' });
      });
    p.catch(() => cache.delete(key));
    cache.set(key, p);
    if (cache.size > 10) cache.delete(cache.keys().next().value);
    return p;
  },

  prepare(text, opts) {
    return Promise.all(chunkText(text).slice(0, 1).map((c) => this._chunk(c.text, opts)));
  },

  async speak(text, opts, { onProgress, onWaiting } = {}) {
    const chunks = chunkText(text);
    let stopped = false;
    this._stopFlag = () => { stopped = true; };
    // Speed is applied at playback (pitch-preserving); pitch shifting isn't available for Piper.
    const rate = Math.max(0.5, Math.min(2.5, opts.rate || 1));
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      const job = this._chunk(c.text, opts, 'now');
      let done = false;
      job.finally(() => { done = true; }).catch(() => {});
      const t = setTimeout(() => { if (!done && !stopped) onWaiting?.(true, Date.now() - 400); }, 400);
      const buffer = await job.finally(() => { clearTimeout(t); onWaiting?.(false); });
      if (stopped) return false;
      if (chunks[i + 1]) this._chunk(chunks[i + 1].text, opts).catch(() => {});
      const ok = await player.play(buffer, {
        rate,
        volume: opts.volume,
        onProgress: onProgress && ((f) => onProgress((c.start + f * c.text.length) / text.length)),
      });
      if (!ok || stopped) return false;
    }
    return true;
  },

  async speedTest(voice = DEFAULT_VOICE) {
    await this.init(null, voice);
    const text = 'This is a short test of how quickly your device can read aloud.';
    cache.delete(`${voice}|${text}`);
    const t0 = performance.now();
    await this._chunk(text, { voice }, 'now');
    const ms = performance.now() - t0;
    return { seconds: ms / 1000, audio: this.stats.audio, factor: (ms / 1000) / (this.stats.audio || 1) };
  },

  stop() { this._stopFlag?.(); player.stop(); worker?.postMessage({ type: 'drop-later' }); },
  pause() { player.pause(); },
  resume() { player.resume(); },
};
