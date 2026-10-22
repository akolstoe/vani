// Engine: the browser/OS built-in voices (Web Speech API). Instant, offline on most devices.

function loadVoices() {
  return new Promise((resolve) => {
    const v = speechSynthesis.getVoices();
    if (v.length) return resolve(v);
    const done = () => resolve(speechSynthesis.getVoices());
    speechSynthesis.addEventListener('voiceschanged', done, { once: true });
    setTimeout(done, 1500);
  });
}

export const webspeech = {
  id: 'webspeech',
  name: 'Device voices',
  description: 'Built into your browser or operating system. Instant and offline; quality varies by device.',
  supportsPitch: true,
  available: () => 'speechSynthesis' in window,
  _current: null,

  async init() { await loadVoices(); },

  async voices() {
    const list = await loadVoices();
    return list
      .map((v) => ({ id: v.voiceURI, name: v.name, lang: v.lang, group: v.localService ? 'On this device' : 'Online' }))
      .sort((a, b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name));
  },

  prepare() { return null; },

  speak(text, opts, { onWord } = {}) {
    return new Promise(async (resolve) => {
      const voices = await loadVoices();
      const u = new SpeechSynthesisUtterance(text);
      const v = voices.find((x) => x.voiceURI === opts.voice) || voices.find((x) => x.default);
      if (v) { u.voice = v; u.lang = v.lang; }
      u.rate = Math.max(0.1, Math.min(10, opts.rate || 1));
      u.pitch = Math.max(0, Math.min(2, 1 + (opts.pitch || 0) / 8));
      u.volume = opts.volume ?? 1;
      u.onboundary = (e) => { if (e.name === 'word' || e.name === undefined) onWord?.(e.charIndex, e.charLength); };
      let settled = false;
      const finish = (ok) => { if (!settled) { settled = true; this._current = null; resolve(ok); } };
      u.onend = () => finish(true);
      u.onerror = (e) => finish(e.error === 'interrupted' || e.error === 'canceled' ? false : true);
      this._current = { finish };
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    });
  },

  stop() {
    const c = this._current;
    speechSynthesis.cancel();
    c?.finish(false);
  },
  pause() { speechSynthesis.pause(); },
  resume() { speechSynthesis.resume(); },
};
