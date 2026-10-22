import { h, icon, toast, field } from '../ui.js';
import { ENGINES } from '../tts/narrator.js';
import { settings } from '../settings.js';
import { unlockAudio } from './reader.js';

const SAMPLE = 'Every book deserves a voice. This is how I would read yours.';

export async function voicesView(root) {
  const st = settings.get();
  const page = h('div', { class: 'page narrow' },
    h('header', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Voices'),
      h('p', { class: 'muted' }, 'Choose who reads to you. Mix engines per book in the player’s Performance panel.'))));
  root.replaceChildren(page);

  const useBtn = (engine) => h('button', {
    class: `btn sm ${settings.get().engine === engine ? 'ghost' : ''}`,
    disabled: settings.get().engine === engine,
    onclick: async (e) => { await settings.set({ engine, voice: '', dialogueVoice: '' }); toast(`${ENGINES[engine].name} is now the default.`); voicesView(root); },
  }, settings.get().engine === engine ? 'Default ✓' : 'Make default');

  const preview = async (engine, voice, btn) => {
    unlockAudio();
    Object.values(ENGINES).forEach((e) => e.stop());
    btn?.classList.add('busy');
    try {
      await ENGINES[engine].init?.();
      await ENGINES[engine].speak(SAMPLE, { ...settings.get(), voice, pitch: 0, rate: 1 }, {});
    } catch (e) { toast(`Preview failed: ${e.message}`); }
    btn?.classList.remove('busy');
  };

  const voiceGrid = (engine, voices) => h('div', { class: 'voice-grid' }, voices.map((v) => {
    const b = h('button', { class: 'voice-tile', title: `Preview ${v.name}` }, icon('play', 14), h('span', {}, h('strong', {}, v.name), h('span', { class: 'muted small' }, v.group || v.lang)));
    b.onclick = () => preview(engine, v.id, b);
    return b;
  }));

  // ---- Kokoro --------------------------------------------------------------
  const kokoro = ENGINES.kokoro;
  const kStatus = h('div', { class: 'stack' });
  const drawKokoro = async () => {
    if (kokoro.loaded) {
      const result = h('p', { class: 'hint' });
      const test = h('button', { class: 'btn ghost sm' }, icon('timer', 14), 'Test speed');
      test.onclick = async () => {
        test.disabled = true;
        result.textContent = 'Testing…';
        try {
          const r = await kokoro.speedTest();
          const verdict = r.factor <= 0.8 ? 'Fast enough for smooth listening.'
            : r.factor <= 1.5 ? 'Usable, with short pauses between phrases.'
            : 'Too slow for smooth listening on this device — Device voices or your voice server will work better.';
          result.textContent = `Made ${r.audio.toFixed(1)}s of speech in ${r.seconds.toFixed(1)}s. ${verdict}`;
        } catch (e) { result.textContent = `Test failed: ${e.message}`; }
        test.disabled = false;
      };
      kStatus.replaceChildren(h('p', { class: 'ok' }, `Ready · running on ${kokoro.device}`), h('div', { class: 'row wrap' }, test), result, voiceGrid('kokoro', await kokoro.voices()));
    } else {
      const bar = h('div', { class: 'load-bar show' }, h('span'));
      const btn = h('button', { class: 'btn' }, icon('download', 16), 'Download voice model');
      btn.onclick = async () => {
        btn.disabled = true;
        btn.replaceChildren(h('span', { class: 'spinner' }), 'Downloading…');
        kStatus.append(bar);
        try {
          await kokoro.init((p) => { bar.firstChild.style.width = `${Math.round(p * 100)}%`; });
          drawKokoro();
        } catch (e) {
          toast(`Couldn't load Kokoro: ${e.message}`, { duration: 8000 });
          btn.disabled = false;
          btn.replaceChildren(icon('download', 16), 'Try again');
        }
      };
      kStatus.replaceChildren(
        h('p', { class: 'hint' }, `28 voices across American and British English. ${navigator.gpu ? 'Your browser supports WebGPU, so generation will be fast.' : 'No WebGPU here, so it runs on the CPU — expect a short wait per sentence.'} The model downloads once and is cached.`),
        btn, voiceGrid('kokoro', await kokoro.voices()));
    }
  };

  // ---- Device voices ---------------------------------------------------------------
  const ws = ENGINES.webspeech;
  let wsVoices = [];
  try { wsVoices = await ws.voices(); } catch {}
  const langs = [...new Set(wsVoices.map((v) => v.lang.split('-')[0].toLowerCase()).filter(Boolean))].sort();
  const myLang = (navigator.language || 'en').split('-')[0];
  const wsGrid = h('div');
  const drawWs = (lang) => wsGrid.replaceChildren(voiceGrid('webspeech', wsVoices.filter((v) => !lang || v.lang.toLowerCase().startsWith(lang))));
  drawWs(langs.includes(myLang) ? myLang : '');

  // ---- Voice server -----------------------------------------------------------------
  const srv = ENGINES.server;
  const srvBody = h('div', { class: 'stack' });
  const url = h('input', { type: 'url', value: st.serverUrl, placeholder: 'http://localhost:8765' });
  const drawServer = async () => {
    srvBody.replaceChildren(h('p', { class: 'muted' }, h('span', { class: 'spinner' }), ' Checking…'));
    let voices;
    try { voices = await srv.voices(); } catch {
      srvBody.replaceChildren(
        h('p', { class: 'warn' }, `No voice server found at ${settings.get().serverUrl}.`),
        h('p', { class: 'hint' }, 'The server is a small open-source program you run on your own computer (or a GPU machine). It turns a 10–30 second recording into a voice Vani can read with. Setup takes about five minutes — see “server/README.md” in the project.'));
      return;
    }
    let health = {};
    try { health = await srv.health(); } catch {}
    const name = h('input', { type: 'text', placeholder: 'e.g. My voice, Grandpa, Narrator 2' });
    const consent = h('input', { type: 'checkbox' });
    let audio = null; // Blob from recorder or file
    const recorder = voiceRecorder((blob) => { audio = blob; });
    const file = h('input', { type: 'file', accept: 'audio/*', onchange: () => { audio = file.files[0] || null; recorder.reset(file.files[0]); } });
    const add = h('button', { class: 'btn' }, icon('mic', 16), 'Create voice');
    add.onclick = async () => {
      if (!audio) return toast('Record yourself reading the passage, or choose a recording.');
      if (!name.value.trim()) return toast('Give the voice a name.');
      if (!consent.checked) return toast('Please confirm you have permission to use this voice.');
      add.disabled = true;
      add.replaceChildren(h('span', { class: 'spinner' }), 'Creating…');
      try {
        const v = await srv.addVoice(name.value.trim(), audio);
        toast(`Voice “${v.name}” created. Tap it to hear it.`, { duration: 6000 });
        drawServer();
      } catch (e) {
        toast(`Couldn't create the voice: ${e.message}`, { duration: 7000 });
        add.disabled = false;
        add.replaceChildren(icon('mic', 16), 'Create voice');
      }
    };
    const list = h('div', { class: 'voice-grid' }, voices.map((v) => {
      const b = h('button', { class: 'voice-tile grow', title: `Preview ${v.name}` }, icon('play', 14),
        h('span', {}, h('strong', {}, v.name), h('span', { class: 'muted small' }, 'Your voice')));
      b.onclick = () => preview('server', v.id, b);
      const del = h('button', { class: 'icon-btn', 'aria-label': `Delete ${v.name}`, title: 'Delete voice', onclick: async () => {
        const { confirmDialog } = await import('../ui.js');
        if (!(await confirmDialog(`Delete the voice “${v.name}”? The recording is removed from your computer.`))) return;
        try { await srv.deleteVoice(v.id); drawServer(); } catch (e) { toast(e.message); }
      } }, icon('trash', 16));
      return h('div', { class: 'row voice-row' }, b, del);
    }));
    srvBody.replaceChildren(
      h('p', { class: 'ok' }, `Connected · ${voices.length} voice${voices.length === 1 ? '' : 's'}${health.device ? ` · running on ${health.device === 'cuda' ? 'your NVIDIA GPU' : health.device.toUpperCase()}` : ''}${health.model_loaded === false ? ' · model still loading' : ''}`),
      voices.length ? list : '',
      h('div', { class: 'add-voice' },
        h('h3', {}, 'Clone a voice'),
        h('p', { class: 'hint' }, 'In a quiet room, read the passage below in your natural reading voice. 15–30 seconds is ideal.'),
        recorder.el,
        h('details', {}, h('summary', { class: 'hint' }, 'Or upload a recording instead'), file),
        field('Name', name),
        h('label', { class: 'consent' }, consent, h('span', {}, 'This is my own voice, or I have the speaker’s permission to create and use it.')),
        add));
  };

  page.append(
    h('section', { class: 'card' },
      h('header', { class: 'card-head' }, h('div', {}, h('h2', {}, 'Kokoro'), h('span', { class: 'badge' }, 'Neural · on-device · free')), useBtn('kokoro')),
      h('p', {}, kokoro.description), kStatus),
    h('section', { class: 'card' },
      h('header', { class: 'card-head' }, h('div', {}, h('h2', {}, 'Your voices'), h('span', { class: 'badge' }, 'Custom & cloned · self-hosted')), useBtn('server')),
      h('p', {}, 'Read any book in your own voice — or any voice you have permission to use — with open-source voice cloning running on your own machine.'),
      h('div', { class: 'row grow' }, field('Server address', url),
        h('button', { class: 'btn ghost sm', onclick: async () => { await settings.set({ serverUrl: url.value.trim() }); srv.loaded = false; drawServer(); } }, 'Connect')),
      srvBody),
    h('section', { class: 'card' },
      h('header', { class: 'card-head' }, h('div', {}, h('h2', {}, 'Device voices'), h('span', { class: 'badge' }, `${wsVoices.length} available · instant`)), useBtn('webspeech')),
      h('p', {}, ws.description),
      langs.length > 1 ? h('select', { onchange: (e) => drawWs(e.target.value) },
        h('option', { value: '' }, 'All languages'),
        langs.map((l) => h('option', { value: l, selected: l === myLang }, languageName(l)))) : null,
      wsGrid));

  drawKokoro().catch((e) => kStatus.replaceChildren(h('p', { class: 'warn' }, `Couldn't load this section: ${e.message}`)));
  drawServer().catch((e) => srvBody.replaceChildren(h('p', { class: 'warn' }, `Couldn't load this section: ${e.message}`)));
}

const READING = `When the sunlight strikes raindrops in the air, they act as a prism and form a rainbow. ` +
  `I remember the quiet of that old house: the clock ticking, the kettle starting to sing, and somebody laughing in the next room. ` +
  `"Are you coming?" she asked. I wasn't sure. Still, I picked up my coat, checked my pockets twice, and stepped out into the cold, bright morning.`;

function voiceRecorder(onAudio) {
  let media = null, rec = null, chunks = [], started = 0, tick = null, raf = null, analyser = null;
  const time = h('span', { class: 'rec-time' }, '0:00');
  const meter = h('div', { class: 'rec-meter' }, h('span'));
  const player = h('audio', { controls: true, hidden: true, class: 'rec-player' });
  const btn = h('button', { class: 'rec-btn', 'aria-label': 'Start recording' }, icon('mic', 22));
  const label = h('span', { class: 'muted small' }, 'Tap to record');
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  const stop = () => {
    rec?.state === 'recording' && rec.stop();
    media?.getTracks().forEach((t) => t.stop());
    clearInterval(tick); cancelAnimationFrame(raf);
    btn.classList.remove('on');
    btn.replaceChildren(icon('mic', 22));
    meter.firstChild.style.width = '0%';
  };

  btn.onclick = async () => {
    if (rec?.state === 'recording') { stop(); return; }
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true } });
    } catch {
      toast('Microphone access was blocked. Allow it in your browser’s site settings, or upload a recording instead.', { duration: 7000 });
      return;
    }
    chunks = [];
    rec = new MediaRecorder(media);
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
      const secs = (Date.now() - started) / 1000;
      player.src = URL.createObjectURL(blob);
      player.hidden = false;
      label.textContent = secs < 10 ? `Only ${Math.round(secs)}s — try for 15–30s` : `Recorded ${fmt(secs)}. Listen back, or tap to re-record.`;
      onAudio(blob);
    };
    const { audioContext } = await import('../tts/audio.js');
    const ac = audioContext();
    await ac.resume();
    analyser = ac.createAnalyser();
    analyser.fftSize = 512;
    ac.createMediaStreamSource(media).connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    const draw = () => {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
      meter.firstChild.style.width = `${Math.min(100, (peak / 128) * 160)}%`;
      raf = requestAnimationFrame(draw);
    };
    draw();
    rec.start();
    started = Date.now();
    btn.classList.add('on');
    btn.replaceChildren(h('span', { class: 'rec-stop' }));
    label.textContent = 'Recording… tap to stop';
    player.hidden = true;
    tick = setInterval(() => {
      const s = (Date.now() - started) / 1000;
      time.textContent = fmt(s);
      if (s >= 45) stop();
    }, 250);
  };

  const el = h('div', { class: 'recorder' },
    h('blockquote', { class: 'reading-passage' }, READING),
    h('div', { class: 'row' }, btn, h('div', { class: 'grow stack tight' }, h('div', { class: 'row between' }, label, time), meter)),
    player);
  return {
    el,
    reset(fileBlob) {
      stop();
      if (fileBlob) { player.src = URL.createObjectURL(fileBlob); player.hidden = false; label.textContent = 'Using the uploaded recording.'; }
    },
  };
}

function languageName(code) {
  try { return new Intl.DisplayNames([navigator.language || 'en'], { type: 'language' }).of(code) || code; } catch { return code; }
}
