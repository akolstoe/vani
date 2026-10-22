// The Narrator turns a chapter's sentences into a performance: voices, dialogue casting,
// pauses, pronunciation rules, word tracking, look-ahead synthesis and a sleep timer.
import { webspeech } from './webspeech.js';
import { kokoro } from './kokoro.js';
import { server } from './server.js';

export const ENGINES = { webspeech, kokoro, server };

const sleep = (ms, signal) => new Promise((resolve) => {
  if (ms <= 0) return resolve();
  const t = setTimeout(resolve, ms);
  signal.onabort = () => { clearTimeout(t); resolve(); };
});

// Apply regex replacements while keeping a map from new-text index -> original index,
// so word highlighting stays aligned after "Dr." -> "Doctor" style substitutions.
export function transformText(text, opts) {
  const rules = [{ re: /\s{2,}/g, to: ' ' }];
  if (opts.skipBrackets) rules.push({ re: /\s?\[\d{1,3}\]|\s?\[[a-z]\]/g, to: '' });
  for (const r of opts.pronunciations || []) {
    if (!r.from) continue;
    const esc = r.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    rules.push({ re: new RegExp(r.whole === false ? esc : `\\b${esc}\\b`, r.caseSensitive ? 'g' : 'gi'), to: r.to ?? '' });
  }
  let cur = text;
  let map = [...text].map((_, i) => i);
  map.push(text.length);
  for (const { re, to } of rules) {
    let out = '';
    const nmap = [];
    let last = 0;
    cur.replace(re, (m, ...args) => {
      const idx = args[args.length - 2];
      out += cur.slice(last, idx);
      for (let k = last; k < idx; k++) nmap.push(map[k]);
      out += to;
      for (let k = 0; k < to.length; k++) nmap.push(map[idx]);
      last = idx + m.length;
      return m;
    });
    out += cur.slice(last);
    for (let k = last; k < cur.length; k++) nmap.push(map[k]);
    nmap.push(map[cur.length]);
    cur = out;
    map = nmap;
  }
  return { text: cur, map };
}

// Split a sentence into narration and quoted dialogue.
export function splitDialogue(text) {
  const re = /“[^”]+”?|"[^"]+"|‘[^’]{3,}’(?=\W|$)/g;
  const parts = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index), start: last, dialogue: false });
    parts.push({ text: m[0], start: m.index, dialogue: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), start: last, dialogue: false });
  return parts.filter((p) => /[\p{L}\p{N}]/u.test(p.text));
}

export class Narrator extends EventTarget {
  constructor(reader) {
    super();
    this.reader = reader;
    this.state = 'idle';
    this.index = 0;
    this.opts = {};
    this.run = 0;
    this.abort = null;
    this.sleepAt = null; // timestamp ms, or 'chapter'
  }

  get engine() { return ENGINES[this.opts.engine] || webspeech; }

  setOptions(opts) {
    const restart = this.state === 'playing' &&
      ['engine', 'voice', 'dialogueVoice', 'rate', 'pitch', 'dialogueEnabled', 'expressiveness'].some((k) => opts[k] !== this.opts[k]);
    this.opts = { ...opts };
    if (restart) this.play(this.index);
  }

  _set(state, extra = {}) {
    this.state = state;
    this.dispatchEvent(new CustomEvent('state', { detail: { state, index: this.index, ...extra } }));
  }

  segmentsFor(sentence) {
    const o = this.opts;
    const parts = o.dialogueEnabled ? splitDialogue(sentence.text) : [{ text: sentence.text, start: 0, dialogue: false }];
    return parts.map((p) => {
      const t = transformText(p.text, o);
      const voice = p.dialogue && o.dialogueVoice ? o.dialogueVoice : o.voice;
      return { ...p, spoken: t.text.trim() ? t.text : '', map: t.map, opts: { ...o, voice } };
    }).filter((p) => p.spoken);
  }

  prefetch(i) {
    const s = this.reader.sentences[i];
    if (!s) return;
    for (const seg of this.segmentsFor(s)) {
      try { this.engine.prepare(seg.spoken, seg.opts)?.catch?.(() => {}); } catch {}
    }
  }

  async play(from = this.index) {
    const run = ++this.run;
    this.abort?.abort();
    this.engine.stop();
    for (const e of Object.values(ENGINES)) if (e !== this.engine) e.stop();
    this.index = Math.max(0, from);
    const ac = new AbortController();
    this.abort = ac;

    if (this.engine.id !== 'webspeech' && !this.engine.loaded) {
      this._set('loading');
      try {
        await this.engine.init((p, file) => this.dispatchEvent(new CustomEvent('loading', { detail: { progress: p, file } })));
      } catch (e) {
        if (run !== this.run) return;
        this._set('idle');
        this.dispatchEvent(new CustomEvent('error', { detail: { message: e.message || String(e) } }));
        return;
      }
      if (run !== this.run) return;
    }
    this._set('playing');

    while (run === this.run) {
      const sentences = this.reader.sentences;
      if (this.index >= sentences.length) {
        if (this.sleepAt === 'chapter' || !this.opts.autoAdvance) { this.sleepAt = null; this.stop(true); return; }
        await sleep(this.opts.chapterPause, ac.signal);
        if (run !== this.run) return;
        const ok = await this.reader.goChapter(this.reader.chapterIndex + 1, 0);
        if (!ok || run !== this.run) { this.stop(true); return; }
        this.index = 0;
        continue;
      }
      if (typeof this.sleepAt === 'number' && Date.now() >= this.sleepAt) {
        this.sleepAt = null;
        this.stop(true);
        this.dispatchEvent(new CustomEvent('slept'));
        return;
      }

      const s = sentences[this.index];
      this.reader.markSentence(this.index, this.opts);
      this._set('playing');
      this.prefetch(this.index + 1);
      if (this.engine.id === 'server') this.prefetch(this.index + 2);

      try {
        for (const seg of this.segmentsFor(s)) {
          if (run !== this.run) return;
          const toOriginal = (k) => seg.start + (seg.map[Math.min(k, seg.map.length - 1)] ?? 0);
          await this.engine.speak(seg.spoken, seg.opts, {
            onWord: (ci) => this.opts.highlight === 'word' && this.reader.markWord(this.index, toOriginal(ci)),
            onProgress: (f) => this.opts.highlight === 'word' && this.reader.markWord(this.index, toOriginal(Math.floor(f * seg.spoken.length))),
          });
        }
      } catch (e) {
        if (run !== this.run) return;
        this.stop(true);
        this.dispatchEvent(new CustomEvent('error', { detail: { message: e.message || String(e) } }));
        return;
      }
      if (run !== this.run) return;

      const pause = s.kind === 'heading' ? this.opts.headingPause
        : s.paraEnd ? this.opts.paragraphPause : this.opts.sentencePause;
      await sleep(pause / Math.max(0.5, this.opts.rate || 1), ac.signal);
      if (run !== this.run) return;
      this.index++;
      this.dispatchEvent(new CustomEvent('advance', { detail: { index: this.index } }));
    }
  }

  pause() {
    if (this.state !== 'playing') return;
    this.run++;
    this.abort?.abort();
    this.engine.stop();
    this._set('paused');
  }

  resume() { this.play(this.index); }

  toggle() {
    if (this.state === 'playing' || this.state === 'loading') this.pause();
    else this.play(this.index);
  }

  skip(delta) {
    const n = this.reader.sentences.length;
    this.index = Math.max(0, Math.min(n - 1, this.index + delta));
    if (this.state === 'playing') this.play(this.index);
    else this.reader.markSentence(this.index, this.opts);
  }

  stop(keepPosition = false) {
    this.run++;
    this.abort?.abort();
    Object.values(ENGINES).forEach((e) => e.stop());
    if (!keepPosition) this.index = 0;
    this._set('idle');
  }
}
