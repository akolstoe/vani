// Engine: Kokoro-82M, an open-weight (Apache-2.0) neural TTS model that runs entirely
// in the browser. The model runs in a background worker so the app stays responsive,
// and long sentences are split into short pieces so speech starts quickly.
import { AudioPlayer, floatToBuffer, pitchFactor } from './audio.js';

const VOICES = [
  ['af_heart', 'Heart', 'American English · F'], ['af_bella', 'Bella', 'American English · F'],
  ['af_nicole', 'Nicole', 'American English · F'], ['af_aoede', 'Aoede', 'American English · F'],
  ['af_kore', 'Kore', 'American English · F'], ['af_sarah', 'Sarah', 'American English · F'],
  ['af_nova', 'Nova', 'American English · F'], ['af_sky', 'Sky', 'American English · F'],
  ['af_alloy', 'Alloy', 'American English · F'], ['af_jessica', 'Jessica', 'American English · F'],
  ['af_river', 'River', 'American English · F'],
  ['am_michael', 'Michael', 'American English · M'], ['am_fenrir', 'Fenrir', 'American English · M'],
  ['am_puck', 'Puck', 'American English · M'], ['am_echo', 'Echo', 'American English · M'],
  ['am_eric', 'Eric', 'American English · M'], ['am_liam', 'Liam', 'American English · M'],
  ['am_onyx', 'Onyx', 'American English · M'], ['am_adam', 'Adam', 'American English · M'],
  ['am_santa', 'Santa', 'American English · M'],
  ['bf_emma', 'Emma', 'British English · F'], ['bf_isabella', 'Isabella', 'British English · F'],
  ['bf_alice', 'Alice', 'British English · F'], ['bf_lily', 'Lily', 'British English · F'],
  ['bm_george', 'George', 'British English · M'], ['bm_fable', 'Fable', 'British English · M'],
  ['bm_lewis', 'Lewis', 'British English · M'], ['bm_daniel', 'Daniel', 'British English · M'],
];

export const isPhone = () => navigator.userAgentData?.mobile ?? /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

// Split text into pieces of at most ~max chars, preferring clause boundaries.
export function chunkText(text, max = isPhone() ? 110 : 220) {
  if (text.length <= max) return [{ text, start: 0 }];
  const out = [];
  let start = 0;
  while (start < text.length) {
    if (text.length - start <= max) { out.push({ text: text.slice(start), start }); break; }
    const win = text.slice(start, start + max);
    let cut = -1;
    for (const re of [/[;:—–](\s|$)/g, /,\s/g, /\s/g]) {
      let m;
      while ((m = re.exec(win))) if (m.index > max * 0.35) cut = m.index + 1;
      if (cut > 0) break;
    }
    if (cut <= 0) cut = max;
    out.push({ text: text.slice(start, start + cut), start });
    start += cut;
    while (text[start] === ' ') start++;
  }
  return out.filter((c) => /[\p{L}\p{N}]/u.test(c.text));
}

let worker = null;
let readyPromise = null;
let nextId = 1;
const pending = new Map();
let progressCb = null;
const player = new AudioPlayer();
const cache = new Map();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./kokoro-worker.js', import.meta.url), { type: 'module' });
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
    worker = null; readyPromise = null; kokoro.loaded = false;
  };
  return worker;
}

function call(msg) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ ...msg, id });
  });
}

export const kokoro = {
  id: 'kokoro',
  name: 'Kokoro (neural, on-device)',
  description: 'Natural, expressive voices generated privately on your device. One-time download. On phones each sentence takes a moment to prepare.',
  supportsPitch: true,
  available: () => typeof Worker !== 'undefined',
  loaded: false,
  device: '',

  init(onProgress) {
    if (onProgress) progressCb = onProgress;
    if (!readyPromise) {
      readyPromise = call({ type: 'init', allowGpu: !isPhone() }).then((r) => {
        this.loaded = true;
        this.device = r.device;
        return r;
      }).catch((e) => { readyPromise = null; throw e; });
    }
    return readyPromise;
  },

  async voices() {
    return VOICES.map(([id, name, group]) => ({ id, name, lang: id.startsWith('b') ? 'en-GB' : 'en-US', group }));
  },

  _chunk(text, opts) {
    const factor = pitchFactor(opts.pitch);
    const speed = Math.max(0.5, Math.min(2, (opts.rate || 1) / factor));
    const key = `${opts.voice}|${speed}|${text}`;
    if (!cache.has(key)) {
      const p = this.init()
        .then(() => call({ type: 'generate', text, voice: opts.voice || 'af_heart', speed }))
        .then((r) => floatToBuffer(r.audio, r.sampleRate));
      p.catch(() => cache.delete(key));
      cache.set(key, p);
      if (cache.size > (isPhone() ? 6 : 16)) cache.delete(cache.keys().next().value);
    }
    return cache.get(key);
  },

  // Start generating the first piece(s) of a sentence ahead of time.
  prepare(text, opts) {
    return Promise.all(chunkText(text).slice(0, 2).map((c) => this._chunk(c.text, opts)));
  },

  async speak(text, opts, { onProgress, onWaiting } = {}) {
    const chunks = chunkText(text);
    let stopped = false;
    this._stopFlag = () => { stopped = true; };
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      const job = this._chunk(c.text, opts);
      let done = false;
      job.finally(() => { done = true; }).catch(() => {});
      const t = setTimeout(() => { if (!done && !stopped) onWaiting?.(true); }, 400);
      const buffer = await job.finally(() => { clearTimeout(t); onWaiting?.(false); });
      if (stopped) return false;
      if (chunks[i + 1]) this._chunk(chunks[i + 1].text, opts).catch(() => {});
      const ok = await player.play(buffer, {
        pitch: opts.pitch,
        volume: opts.volume,
        onProgress: onProgress && ((f) => onProgress((c.start + f * c.text.length) / text.length)),
      });
      if (!ok || stopped) return false;
    }
    return true;
  },

  stop() { this._stopFlag?.(); player.stop(); },
  pause() { player.pause(); },
  resume() { player.resume(); },
};
