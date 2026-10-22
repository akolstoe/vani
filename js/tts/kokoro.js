// Engine: Kokoro-82M, an open-weight (Apache-2.0) neural TTS model that runs entirely
// in the browser via WebGPU or WebAssembly. Downloads ~90–330 MB once, then is cached.
import { AudioPlayer, floatToBuffer, pitchFactor } from './audio.js';

const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const LIB = 'https://cdn.jsdelivr.net/npm/kokoro-js@1/+esm';

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

let ttsPromise = null;
const player = new AudioPlayer();
const cache = new Map();
let queue = Promise.resolve();

export const kokoro = {
  id: 'kokoro',
  name: 'Kokoro (neural, on-device)',
  description: 'Natural, expressive voices generated privately in your browser. One-time model download; fastest with WebGPU.',
  supportsPitch: true,
  available: () => true,
  loaded: false,

  init(onProgress) {
    if (!ttsPromise) {
      ttsPromise = (async () => {
        const { KokoroTTS } = await import(/* @vite-ignore */ LIB);
        // Phones crash on the full-precision GPU model (~330 MB), so they get the compact one (~90 MB).
        const webgpu = !isPhone() && !!navigator.gpu && !!(await navigator.gpu.requestAdapter().catch(() => null));
        const tts = await KokoroTTS.from_pretrained(MODEL, {
          dtype: webgpu ? 'fp32' : 'q8',
          device: webgpu ? 'webgpu' : 'wasm',
          progress_callback: (p) => {
            if (p.status === 'progress' && p.total) onProgress?.(p.loaded / p.total, p.file);
          },
        });
        this.loaded = true;
        this.device = webgpu ? 'WebGPU' : 'WebAssembly';
        return tts;
      })().catch((e) => { ttsPromise = null; throw e; });
    }
    return ttsPromise;
  },

  async voices() {
    return VOICES.map(([id, name, group]) => ({ id, name, lang: id.startsWith('b') ? 'en-GB' : 'en-US', group }));
  },

  prepare(text, opts) {
    const factor = pitchFactor(opts.pitch);
    const key = `${opts.voice}|${opts.rate}|${opts.pitch}|${text}`;
    if (!cache.has(key)) {
      // One generation at a time: running several in parallel doubles memory use.
      const p = queue = queue.catch(() => {}).then(() => this.init()).then(async (tts) => {
        const out = await tts.generate(text, {
          voice: opts.voice || 'af_heart',
          speed: Math.max(0.5, Math.min(2, (opts.rate || 1) / factor)),
        });
        return floatToBuffer(out.audio, out.sampling_rate);
      });
      p.catch(() => cache.delete(key));
      cache.set(key, p);
      if (cache.size > (isPhone() ? 4 : 12)) cache.delete(cache.keys().next().value);
    }
    return cache.get(key);
  },

  async speak(text, opts, { onProgress } = {}) {
    const buffer = await this.prepare(text, opts);
    return player.play(buffer, { pitch: opts.pitch, volume: opts.volume, onProgress });
  },

  stop() { player.stop(); },
  pause() { player.pause(); },
  resume() { player.resume(); },
};
