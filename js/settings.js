// App-wide settings with per-book performance overrides.
import { getKV, setKV } from './db.js';

export const DEFAULTS = {
  // Appearance
  theme: 'auto', // auto | paper | sepia | night
  fontFamily: 'literata', // literata | serif | sans | dyslexic
  fontSize: 19,
  lineHeight: 1.65,
  measure: 38, // em
  justify: false,

  // Performance (narration)
  engine: 'webspeech', // webspeech | kokoro | server
  voice: '', // narrator voice id for the engine
  dialogueVoice: '', // separate voice for quoted speech ('' = same as narrator)
  dialogueEnabled: false,
  rate: 1.0,
  pitch: 0, // semitones, -6..+6
  volume: 1.0,
  sentencePause: 150, // ms
  paragraphPause: 450,
  headingPause: 800,
  chapterPause: 1500,
  highlight: 'word', // word | sentence | none
  autoScroll: true,
  autoAdvance: true,
  skipBrackets: true, // skip [1], [12] footnote markers
  pronunciations: [], // [{from, to, whole: true}]

  // Voice server (for custom / cloned voices)
  serverUrl: 'http://localhost:8765',

  // Catalog
  corsProxy: '', // e.g. http://localhost:8765/fetch?url={url}
};

export const PERFORMANCE_KEYS = [
  'engine', 'voice', 'dialogueVoice', 'dialogueEnabled', 'rate', 'pitch', 'volume',
  'sentencePause', 'paragraphPause', 'headingPause', 'chapterPause', 'highlight',
  'autoScroll', 'autoAdvance', 'skipBrackets', 'pronunciations',
];

export const PRESETS = {
  Audiobook: { rate: 1.0, pitch: 0, sentencePause: 180, paragraphPause: 500, headingPause: 900, chapterPause: 1800, dialogueEnabled: true },
  'Quick listen': { rate: 1.5, pitch: 0, sentencePause: 40, paragraphPause: 150, headingPause: 300, chapterPause: 600 },
  Bedtime: { rate: 0.85, pitch: -1, volume: 0.7, sentencePause: 350, paragraphPause: 900, headingPause: 1400, chapterPause: 3000 },
  Dramatic: { rate: 0.95, pitch: 0, sentencePause: 260, paragraphPause: 800, headingPause: 1300, chapterPause: 2500, dialogueEnabled: true },
  Study: { rate: 0.9, pitch: 0, sentencePause: 300, paragraphPause: 700, headingPause: 1000, chapterPause: 1500, highlight: 'word' },
};

let current = { ...DEFAULTS };
const listeners = new Set();

export const settings = {
  get: () => current,
  async load() {
    current = { ...DEFAULTS, ...(await getKV('settings', {})) };
    return current;
  },
  async set(patch) {
    current = { ...current, ...patch };
    await setKV('settings', current);
    listeners.forEach((fn) => fn(current, patch));
  },
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  // Per-book performance profile (falls back to global)
  async forBook(bookId) {
    const own = (await getKV(`perf:${bookId}`, null)) || {};
    return { ...current, ...own, _bookOverride: Object.keys(own).length > 0 };
  },
  async setForBook(bookId, patch) {
    const own = (await getKV(`perf:${bookId}`, null)) || {};
    await setKV(`perf:${bookId}`, { ...own, ...patch });
  },
  async clearBook(bookId) { await setKV(`perf:${bookId}`, null); },
};
