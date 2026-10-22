// Engine: a voice server you run yourself (see /server). This is where custom and cloned
// voices live: any open-source model can sit behind this small HTTP contract:
//   GET  /voices                 -> [{ id, name, group? }]
//   POST /tts  {text, voice, speed} -> audio (wav/mp3/ogg)
//   POST /voices (multipart: name, consent, file) -> { id, name }
import { AudioPlayer, audioContext, pitchFactor } from './audio.js';
import { settings } from '../settings.js';

const player = new AudioPlayer();
const cache = new Map();
const base = () => settings.get().serverUrl.replace(/\/+$/, '');

export const server = {
  id: 'server',
  name: 'Voice server (custom & cloned voices)',
  description: 'Connect to your own open-source voice server to use cloned or custom voices — your voice, or any voice you have permission to use.',
  supportsPitch: true,
  available: () => true,

  async init() {
    const r = await fetch(`${base()}/voices`);
    if (!r.ok) throw new Error(`Voice server answered ${r.status}`);
    this.loaded = true;
  },

  async voices() {
    const r = await fetch(`${base()}/voices`);
    if (!r.ok) throw new Error(`Voice server answered ${r.status}`);
    return (await r.json()).map((v) => ({ id: v.id, name: v.name, lang: v.lang || '', group: v.group || 'Server voices' }));
  },

  async addVoice(name, file) {
    const fd = new FormData();
    fd.append('name', name);
    fd.append('consent', 'true');
    fd.append('file', file);
    const r = await fetch(`${base()}/voices`, { method: 'POST', body: fd });
    if (!r.ok) throw new Error(await r.text() || `Upload failed (${r.status})`);
    return r.json();
  },

  prepare(text, opts) {
    const factor = pitchFactor(opts.pitch);
    const key = `${opts.voice}|${opts.rate}|${opts.pitch}|${text}`;
    if (!cache.has(key)) {
      const p = (async () => {
        const r = await fetch(`${base()}/tts`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, voice: opts.voice, speed: (opts.rate || 1) / factor }),
        });
        if (!r.ok) throw new Error(`Voice server answered ${r.status}`);
        return audioContext().decodeAudioData(await r.arrayBuffer());
      })();
      p.catch(() => cache.delete(key));
      cache.set(key, p);
      if (cache.size > 12) cache.delete(cache.keys().next().value);
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
