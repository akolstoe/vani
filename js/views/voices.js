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
      kStatus.replaceChildren(h('p', { class: 'ok' }, `Ready · running on ${kokoro.device}`), voiceGrid('kokoro', await kokoro.voices()));
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
  const langs = [...new Set(wsVoices.map((v) => v.lang.split('-')[0]))].sort();
  const myLang = (navigator.language || 'en').split('-')[0];
  const wsGrid = h('div');
  const drawWs = (lang) => wsGrid.replaceChildren(voiceGrid('webspeech', wsVoices.filter((v) => !lang || v.lang.startsWith(lang))));
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
    const name = h('input', { type: 'text', placeholder: 'e.g. Grandpa, My voice, Narrator 2' });
    const file = h('input', { type: 'file', accept: 'audio/*' });
    const consent = h('input', { type: 'checkbox' });
    const add = h('button', { class: 'btn' }, icon('upload', 16), 'Create voice');
    add.onclick = async () => {
      if (!name.value.trim() || !file.files[0]) return toast('Give the voice a name and choose a recording.');
      if (!consent.checked) return toast('Please confirm you have permission to use this voice.');
      add.disabled = true;
      try {
        await srv.addVoice(name.value.trim(), file.files[0]);
        toast(`Voice “${name.value.trim()}” created.`);
        drawServer();
      } catch (e) { toast(`Upload failed: ${e.message}`); add.disabled = false; }
    };
    srvBody.replaceChildren(
      h('p', { class: 'ok' }, `Connected · ${voices.length} voice${voices.length === 1 ? '' : 's'}`),
      voices.length ? voiceGrid('server', voices) : null,
      h('div', { class: 'add-voice' },
        h('h3', {}, 'Add a voice'),
        h('p', { class: 'hint' }, 'Upload a clean recording of one person speaking, 10–30 seconds, no music or background noise.'),
        field('Name', name), field('Recording', file),
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
        langs.map((l) => h('option', { value: l, selected: l === myLang }, new Intl.DisplayNames([navigator.language || 'en'], { type: 'language' }).of(l) || l))) : null,
      wsGrid));

  drawKokoro();
  drawServer();
}
