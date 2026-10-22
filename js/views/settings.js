import { h, toast, field, toggle, select, slider, confirmDialog } from '../ui.js';
import { settings } from '../settings.js';
import { db } from '../db.js';

export async function settingsView(root) {
  const st = settings.get();
  const est = navigator.storage?.estimate ? await navigator.storage.estimate().catch(() => null) : null;
  const persisted = navigator.storage?.persisted ? await navigator.storage.persisted().catch(() => false) : false;
  const proxy = h('input', { type: 'url', value: st.corsProxy, placeholder: 'http://localhost:8765/fetch?url={url}' });

  root.replaceChildren(h('div', { class: 'page narrow' },
    h('header', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Settings'))),

    h('section', { class: 'card' }, h('h2', {}, 'Reading'),
      field('Theme', select([{ value: 'auto', label: 'Match system' }, { value: 'paper', label: 'Paper' }, { value: 'sepia', label: 'Sepia' }, { value: 'night', label: 'Night' }], st.theme, (v) => settings.set({ theme: v }))),
      field('Typeface', select([{ value: 'literata', label: 'Literata (book)' }, { value: 'serif', label: 'Classic serif' }, { value: 'sans', label: 'Sans-serif' }, { value: 'dyslexic', label: 'High legibility' }], st.fontFamily, (v) => settings.set({ fontFamily: v }))),
      slider({ label: 'Text size', min: 14, max: 30, step: 1, value: st.fontSize, format: (v) => `${v}px`, onInput: (v) => settings.set({ fontSize: v }) }),
      toggle('Justify text', st.justify, (v) => settings.set({ justify: v }))),

    h('section', { class: 'card' }, h('h2', {}, 'Book downloads'),
      h('p', { class: 'hint' }, 'Project Gutenberg sometimes blocks in-browser downloads. If you run the Vani voice server, it includes a download helper: enter its address below, e.g. http://localhost:8765/fetch?url={url}'),
      h('div', { class: 'row grow' }, field('Download helper', proxy),
        h('button', { class: 'btn ghost sm', onclick: async () => { await settings.set({ corsProxy: proxy.value.trim() }); toast('Saved.'); } }, 'Save'))),

    h('section', { class: 'card' }, h('h2', {}, 'Your data'),
      h('p', { class: 'hint' }, 'Everything — books, notes, settings — lives privately in this browser. Nothing is uploaded anywhere.'),
      est ? h('p', {}, `Using ${(est.usage / 1048576).toFixed(1)} MB${est.quota ? ` of ${(est.quota / 1073741824).toFixed(1)} GB available` : ''}.`) : null,
      persisted ? h('p', { class: 'ok' }, 'Storage is protected from automatic clean-up.')
        : h('button', { class: 'btn ghost sm', onclick: async () => {
          const ok = await navigator.storage?.persist?.();
          toast(ok ? 'Storage protected.' : 'Your browser declined. Installing Vani as an app usually helps.');
        } }, 'Protect my library from clean-up'),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn ghost', onclick: backupNotes }, 'Back up notes & settings'),
        h('button', { class: 'btn ghost', onclick: () => restore(root) }, 'Restore backup')),
      h('button', { class: 'btn ghost danger', onclick: async () => {
        if (!(await confirmDialog('Erase every book, note and setting from this browser? This cannot be undone.', 'Erase everything'))) return;
        await Promise.all(['books', 'notes', 'kv'].map((s) => db.clear(s)));
        location.reload();
      } }, 'Erase all data')),

    h('section', { class: 'card' }, h('h2', {}, 'About Vani'),
      h('p', {}, 'Vāṇī (वाणी) is Sanskrit for voice, speech and the spoken word — and a name of Sarasvatī, goddess of learning.'),
      h('p', { class: 'muted' }, 'Free and open source. Voices: your device’s built-in voices, Kokoro-82M (Apache-2.0), and any open-source model behind the Vani voice server. Books: your own DRM-free EPUBs and Project Gutenberg.'),
      h('p', { class: 'muted small' }, 'Shortcuts while reading: Space play/pause · Shift+←/→ previous/next sentence · [ ] previous/next chapter · double-click a sentence to read from there.'))));
}

async function backupNotes() {
  const data = { app: 'vani', version: 1, exported: new Date().toISOString(), notes: await db.all('notes'), kv: await db.all('kv') };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  h('a', { href: url, download: `vani-backup-${new Date().toISOString().slice(0, 10)}.json` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function restore(root) {
  const input = h('input', { type: 'file', accept: 'application/json,.json' });
  input.onchange = async () => {
    try {
      const data = JSON.parse(await input.files[0].text());
      if (data.app !== 'vani') throw new Error('Not a Vani backup');
      for (const n of data.notes || []) await db.put('notes', n);
      for (const k of data.kv || []) await db.put('kv', k);
      await settings.load();
      toast(`Restored ${data.notes?.length || 0} notes.`);
      settingsView(root);
    } catch (e) { toast(`Restore failed: ${e.message}`); }
  };
  input.click();
}
